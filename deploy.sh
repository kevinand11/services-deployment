#!/bin/bash

# Set variables
REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="management-service"

# Build Docker image
docker build -t $REPO_NAME .

# Authenticate Docker to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID".dkr.ecr.$REGION.amazonaws.com

# Create ECR repository if it doesn't exist (optional)
aws ecr describe-repositories --repository-names $REPO_NAME || \
  aws ecr create-repository --repository-name $REPO_NAME

# Tag the image
docker tag $REPO_NAME:latest "$ACCOUNT_ID".dkr.ecr.$REGION.amazonaws.com/$REPO_NAME:latest

# Push the image
docker push "$ACCOUNT_ID".dkr.ecr.$REGION.amazonaws.com/$REPO_NAME:latest