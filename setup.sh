#!/bin/bash

# Selfie Attendance System - Quick Setup Script
# Run this script to set up everything automatically

echo "========================================="
echo "  Selfie Attendance System Setup"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed!${NC}"
    echo "Please install Node.js from: https://nodejs.org"
    echo "Download the LTS version and run the installer."
    exit 1
fi

echo -e "${GREEN}✓ Node.js is installed${NC}"

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}PostgreSQL is not installed!${NC}"
    echo "Please install PostgreSQL from: https://www.postgresql.org/download/"
    echo "After installing, run this script again."
    exit 1
fi

echo -e "${GREEN}✓ PostgreSQL is installed${NC}"
echo ""

# Setup Backend
echo "Setting up Backend..."
cd server

# Install dependencies
echo "Installing backend dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${YELLOW}Created .env file - Please edit it with your database password${NC}"
fi

echo -e "${GREEN}✓ Backend setup complete${NC}"
cd ..

# Setup Dashboard
echo ""
echo "Setting up Dashboard..."
cd dashboard

# Install dependencies
echo "Installing dashboard dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
fi

echo -e "${GREEN}✓ Dashboard setup complete${NC}"
cd ..

# Setup Mobile
echo ""
echo "Setting up Mobile App..."
cd mobile

# Install dependencies
echo "Installing mobile dependencies..."
npm install

echo -e "${GREEN}✓ Mobile app setup complete${NC}"
cd ..

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Setup PostgreSQL database:"
echo "   psql -U postgres -c \"CREATE DATABASE selfie_attendance;\""
echo ""
echo "2. Edit server/.env with your database password"
echo ""
echo "3. Run database migrations:"
echo "   cd server && npm run db:migrate && npm run db:seed"
echo ""
echo "4. Start the server (keep this terminal open):"
echo "   cd server && npm run dev"
echo ""
echo "5. Open a NEW terminal and start dashboard:"
echo "   cd dashboard && npm start"
echo ""
echo "6. Open another terminal for mobile app:"
echo "   cd mobile && npm start"
echo ""
echo "7. Login with: EMP001 / 1234"
echo ""
echo "========================================="
