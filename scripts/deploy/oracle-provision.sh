#!/bin/bash
# Oracle Cloud Ampere A1 provisioner — retries until VM is created.
# Run: bash scripts/deploy/oracle-provision.sh
# Stops when an instance is successfully created. Safe to Ctrl+C and restart.

COMPARTMENT="ocid1.tenancy.oc1..aaaaaaaa2xuhyixsgspdmdgx64xiev5jatafsxnka62mo4kmhib4fya3ynqa"
REGION="us-ashburn-1"
SUBNET_ID="ocid1.subnet.oc1.iad.aaaaaaaa7oymebqiz2xh5kgz7ejwm5pvztweluw2oi5uwv5esfnb7lpqrbvq"
IMAGE_ID="ocid1.image.oc1.iad.aaaaaaaabcwypxed4llxx3bkwdfsbmqhbmpxxa4jsiyanobo55rjbkftcr4a"
STATE_FILE="/tmp/oci-instance-state.json"
RETRY_DELAY=120  # seconds between retry cycles

ADS=("rsEl:US-ASHBURN-AD-1" "rsEl:US-ASHBURN-AD-2" "rsEl:US-ASHBURN-AD-3")

# Ensure SSH key file exists
if [ ! -f /tmp/oci_ssh_key.pub ]; then
  cat ~/.ssh/id_ed25519.pub > /tmp/oci_ssh_key.pub
  echo "SSH key written to /tmp/oci_ssh_key.pub"
fi

echo "=== Oracle Ampere A1 Provisioner ==="
echo "Region: $REGION"
echo "Retry delay: ${RETRY_DELAY}s between cycles"
echo "Press Ctrl+C to stop. Progress is saved to $STATE_FILE"
echo ""

ATTEMPT=0
while true; do
  ATTEMPT=$((ATTEMPT + 1))

  for AD in "${ADS[@]}"; do
    for OCPU in 1 2; do
      MEM=$((OCPU * 6))
      TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "[$TIMESTAMP] Attempt #$ATTEMPT | AD=$AD | OCPU=$OCPU | MEM=${MEM}GB"

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
        echo "  ✅ INSTANCE PROVISIONED SUCCESSFULLY"
        echo "=============================================="
        echo "$RESULT" | python3 -m json.tool
        echo "$RESULT" > "$STATE_FILE"
        echo ""
        echo "To SSH: ssh -i ~/.ssh/id_ed25519 ubuntu@<PUBLIC_IP>"
        echo "State saved to: $STATE_FILE"
        exit 0
      fi

      ERR=$(echo "$RESULT" | grep -o "'message': '[^']*'" 2>/dev/null | head -1 || echo "timeout/network error")
      echo "  ❌ $ERR"

      # Small delay between attempts within a cycle
      sleep 5
    done
  done

  echo "  ⏳ All AD/shape combos exhausted. Waiting ${RETRY_DELAY}s before cycle #$((ATTEMPT + 1))..."
  echo ""

  # Back off after many failures
  if [ $ATTEMPT -gt 30 ]; then
    RETRY_DELAY=600  # 10 min after 1 hour of trying
  fi
  if [ $ATTEMPT -gt 100 ]; then
    RETRY_DELAY=1800  # 30 min after ~4 hours
  fi

  sleep $RETRY_DELAY
done
