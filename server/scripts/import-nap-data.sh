#!/bin/bash
#
# NAP Data Auto-Importer
# One command to standardize and upload any raw NAP export
#
# Usage: ./import-nap-data.sh <raw_nap_file.csv>
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "========================================"
echo "   NAP Data Auto-Importer"
echo "========================================"
echo ""

# Check arguments
if [ $# -eq 0 ]; then
    echo "Usage: ./import-nap-data.sh <raw_nap_file.csv>"
    echo ""
    echo "Example:"
    echo "  ./import-nap-data.sh ~/Downloads/NAP\ Facility\ Summary\ Report-10-25-2026.csv"
    echo ""
    echo "What this does:"
    echo "  1. Standardizes raw NAP data to reference format"
    echo "  2. Removes duplicate NAP IDs automatically"
    echo "  3. Uploads clean data to database (UPSERT mode)"
    echo "  4. Regenerates map snapshot"
    echo "  5. Updates mobile app data (automatic)"
    echo ""
    exit 1
fi

RAW_FILE="$1"

# Check file exists
if [ ! -f "$RAW_FILE" ]; then
    echo -e "${RED}Error: File not found: $RAW_FILE${NC}"
    exit 1
fi

echo -e "${BLUE}Input file:${NC} $(basename "$RAW_FILE")"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVER_DIR="$SCRIPT_DIR"

# If this script is in server/scripts, go up one level
if [[ "$SCRIPT_DIR" == */scripts ]]; then
    SERVER_DIR="$(dirname "$SCRIPT_DIR")"
fi

cd "$SERVER_DIR"

# Step 1: Standardize raw data
echo -e "${YELLOW}Step 1/3: Standardizing raw data...${NC}"
echo "----------------------------------------"
node scripts/process-raw-nap-data.js "$RAW_FILE"
STANDARDIZED_FILE=$(find "$(dirname "$RAW_FILE")" -name "NAP_Standardized_*.csv" -not -name "*_dedup*" -not -name "*_report*" -newer "$RAW_FILE" 2>/dev/null | head -1)

if [ -z "$STANDARDIZED_FILE" ]; then
    echo -e "${RED}Error: Standardization failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Standardization complete${NC}"
echo ""

echo -e "${GREEN}✓ Standardization complete${NC}"
echo ""

# Step 2: Upload to database
echo -e "${YELLOW}Step 2/3: Uploading to database...${NC}"
echo "----------------------------------------"
node scripts/upload-nap-data-safe.js "$STANDARDIZED_FILE" --confirm

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Upload failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Database updated${NC}"
echo ""

# Step 3: Archive processed files
echo -e "${YELLOW}Step 3/3: Archiving files...${NC}"
echo "----------------------------------------"

ARCHIVE_DIR="$HOME/Documents/NAP_Archive"
mkdir -p "$ARCHIVE_DIR"

# Move original file to archive
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVED_RAW="$ARCHIVE_DIR/$(basename "$RAW_FILE" .csv)_${TIMESTAMP}.csv"
cp "$RAW_FILE" "$ARCHIVED_RAW"

echo -e "${GREEN}✓ Original archived to: $(basename "$ARCHIVED_RAW")${NC}"

# Keep standardized file in place for reference
echo -e "${BLUE}✓ Standardized file: $(basename "$STANDARDIZED_FILE")${NC}"

echo ""
echo "========================================"
echo -e "${GREEN}   Import Complete! ✓${NC}"
echo "========================================"
echo ""
echo "Summary:"
echo "  - Raw data processed and standardized"
echo "  - Database updated with clean data"
echo "  - Original file archived safely"
echo "  - Mobile app data refreshed automatically"
echo ""
echo "Files:"
echo "  Standardized: $STANDARDIZED_FILE"
echo "  Archived: $ARCHIVED_RAW"
echo ""
