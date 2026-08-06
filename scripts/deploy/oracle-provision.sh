#!/bin/bash
# Oracle Cloud Ampere A1 provisioner — multi-region, retries until VM created.
# Run: bash scripts/deploy/oracle-provision.sh
# Stops when an instance is successfully created. Safe to Ctrl+C and restart.

set -o pipefail

COMPARTMENT="ocid1.tenancy.oc1..aaaaaaaa2xuhyixsgspdmdgx64xiev5jatafsxnka62mo4kmhib4fya3ynqa"
STATE_FILE="/tmp/oci-instance-state.json"
RETRY_DELAY=60

# Regions + Availability Domains to try
declare -A REGION_ADS
REGION_ADS["us-ashburn-1"]="rsEl:US-ASHBURN-AD-1 rsEl:US-ASHBURN-AD-2 rsEl:US-ASHBURN-AD-3"
REGION_ADS["us-phoenix-1"]="rsEl:PHX-AD-1 rsEl:PHX-AD-2 rsEl:PHX-AD-3"
REGION_ADS["eu-frankfurt-1"]="rsEl:FRA-AD-1 rsEl:FRA-AD-2 rsEl:FRA-AD-3"

# Cached network OCIDs per region (created on first use)
declare -A REGION_SUBNETS
declare -A REGION_IMAGES

# Ensure SSH key
if [ ! -f /tmp/oci_ssh_key.pub ]; then
  cat ~/.ssh/id_ed25519.pub > /tmp/oci_ssh_key.pub
fi

# Ensure cloud-init
if [ ! -f /tmp/cloudinit.yaml ]; then
  cat > /tmp/cloudinit.yaml <<'YAML'
#cloud-config
package_update: true
packages:
  - python3-pip
  - ffmpeg
  - curl
runcmd:
  - python3 -m pip install yt-dlp
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - apt install -y -qq nodejs
YAML
fi

echo "=== Oracle Multi-Region Provisioner ==="
echo "Regions: ${!REGION_ADS[*]}"
echo "Retry delay: ${RETRY_DELAY}s"
echo ""

# ---- helpers ---------------------------------------------------------------

ensure_network() {
  local REGION="$1"
  local SUBNET_ID="${REGION_SUBNETS[$REGION]}"
  if [ -n "$SUBNET_ID" ]; then return 0; fi

  echo "  Setting up network in $REGION..."

  local VCN_ID=$(oci network vcn create --compartment-id "$COMPARTMENT" --region "$REGION" \
    --cidr-block "10.0.0.0/16" --display-name "ytresearch-vcn" --dns-label "yt" \
    --query "data.id" --raw-output 2>/dev/null)
  [ -z "$VCN_ID" ] && return 1

  local SN_ID=$(oci network subnet create --compartment-id "$COMPARTMENT" --region "$REGION" \
    --vcn-id "$VCN_ID" --cidr-block "10.0.1.0/24" --display-name "ytresearch-subnet" \
    --dns-label "sub" --query "data.id" --raw-output 2>/dev/null)
  [ -z "$SN_ID" ] && return 1

  local IGW_ID=$(oci network internet-gateway create --compartment-id "$COMPARTMENT" --region "$REGION" \
    --vcn-id "$VCN_ID" --display-name "ytresearch-igw" --is-enabled true \
    --query "data.id" --raw-output 2>/dev/null)
  [ -z "$IGW_ID" ] && return 1

  local RT_ID=$(oci network route-table list --compartment-id "$COMPARTMENT" --region "$REGION" \
    --vcn-id "$VCN_ID" --query "data[0].id" --raw-output 2>/dev/null)
  oci network route-table update --rt-id "$RT_ID" --region "$REGION" \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW_ID\"}]" --force &>/dev/null

  local SL_ID=$(oci network security-list list --compartment-id "$COMPARTMENT" --region "$REGION" \
    --vcn-id "$VCN_ID" --query "data[0].id" --raw-output 2>/dev/null)
  oci network security-list update --security-list-id "$SL_ID" --region "$REGION" \
    --ingress-security-rules '[
      {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
      {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
      {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}
    ]' \
    --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' --force &>/dev/null

  REGION_SUBNETS[$REGION]="$SN_ID"
  echo "  Network ready in $REGION (subnet: $SN_ID)"
  return 0
}

ensure_image() {
  local REGION="$1"
  local IMG_ID="${REGION_IMAGES[$REGION]}"
  if [ -n "$IMG_ID" ]; then echo "$IMG_ID"; return 0; fi

  IMG_ID=$(oci compute image list --compartment-id "$COMPARTMENT" --region "$REGION" \
    --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
    --shape "VM.Standard.A1.Flex" --sort-by TIMECREATED --sort-order DESC \
    --query "data[0].id" --raw-output 2>/dev/null)
  REGION_IMAGES[$REGION]="$IMG_ID"
  echo "$IMG_ID"
}

try_launch() {
  local REGION="$1" AD="$2" OCPU="$3" MEM="$4"
  local SUBNET_ID="${REGION_SUBNETS[$REGION]}"
  local IMAGE_ID=$(ensure_image "$REGION")
  [ -z "$SUBNET_ID" ] || [ -z "$IMAGE_ID" ] && return 1

  local RESULT
  RESULT=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT" --region "$REGION" \
    --availability-domain "$AD" \
    --display-name "ytresearch" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config "{\"ocpus\":$OCPU,\"memoryInGBs\":$MEM,\"bootVolumeSizeInGBs\":100}" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --assign-public-ip true \
    --ssh-authorized-keys-file /tmp/oci_ssh_key.pub \
    --user-data-file /tmp/cloudinit.yaml \
    --query "data.{ID:id,IP:\"public-ip\",State:\"lifecycle-state\"}" \
    --output json 2>&1)

  if echo "$RESULT" | grep -q '"ID"'; then
    echo ""
    echo "=============================================="
    echo "  ✅ INSTANCE PROVISIONED — $REGION / $AD"
    echo "=============================================="
    echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
    echo "$RESULT" > "$STATE_FILE"
    echo ""
    echo "To SSH: ssh -i ~/.ssh/id_ed25519 ubuntu@<PUBLIC_IP>"
    exit 0
  fi
  return 1
}

# ---- main loop -------------------------------------------------------------

ATTEMPT=0
while true; do
  ATTEMPT=$((ATTEMPT + 1))

  for REGION in "${!REGION_ADS[@]}"; do
    ensure_network "$REGION" || { echo "  ⚠️  Network setup failed for $REGION — skipping"; continue; }

    for AD in ${REGION_ADS[$REGION]}; do
      for OCPU in 4 2; do
        MEM=$((OCPU * 6))
        TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        echo "[$TS] #$ATTEMPT | $REGION | $AD | ${OCPU} OCPU / ${MEM}GB"

        try_launch "$REGION" "$AD" "$OCPU" "$MEM" && exit 0

        echo "  ❌"
        sleep 3
      done
    done
  done

  # Adaptive backoff
  DELAY=$RETRY_DELAY
  [ $ATTEMPT -gt 30 ] && DELAY=300
  [ $ATTEMPT -gt 100 ] && DELAY=600
  echo "  ⏳ Cycle #$ATTEMPT done. Waiting ${DELAY}s..."
  sleep $DELAY
done
