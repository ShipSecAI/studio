# AWS Credential Management

This document covers secure and effective ways to manage AWS credentials for ShipSec Studio MCP components, particularly AWS CloudTrail and AWS CloudWatch.

## Overview

ShipSec Studio supports multiple methods for AWS credential management, ranging from simple environment variables to advanced IAM roles with EKS integration.

## Supported Credential Methods

### 1. Environment Variables

Simple method for development and testing.

#### Environment Setup

```bash
# Backend Environment
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_REGION=us-east-1

# Optional for temporary credentials
export AWS_SESSION_TOKEN=AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE/IvU1dYUg2RVAJBanLiHb4IgPzxj4XvrJOgQP0KM4T
```

#### Docker Compose Configuration

```yaml
version: '3.8'
services:
  backend:
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${AWS_REGION}
      - AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN:-}
    image: shipsec/studio-backend:latest

  worker:
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${AWS_REGION}
      - AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN:-}
    image: shipsec/studio-worker:latest
```

### 2. Backend Configuration File

For more structured configuration, use environment files.

#### Backend .env Configuration

Create `.env` in the backend directory:

```bash
# backend/.env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AWS_SESSION_TOKEN=AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE/IvU1dYUg2RVAJBanLiHb4IgPzxj4XvrJOgQP0KM4T
```

#### Development Setup

```bash
# Create .env file
cat > backend/.env << EOF
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_REGION=${AWS_REGION}
AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN}
EOF

# Start with environment loaded
cd backend && AWS_CONFIG_FILE=.env bun run dev
```

### 3. AWS IAM Roles (Recommended for Production)

The most secure method for production environments.

#### EKS with IRSA (IAM Roles for Service Accounts)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipsec-studio
spec:
  replicas: 1
  template:
    spec:
      serviceAccountName: shipsec-studio-sa
      containers:
        - name: backend
          image: shipsec/studio-backend:latest
          env:
            - name: AWS_ROLE_ARN
              value: arn:aws:iam::123456789012:role/ShipSecBackendRole
            - name: AWS_WEB_IDENTITY_TOKEN_FILE
              value: /var/run/secrets/eks.amazonaws.com/serviceaccount/token
          volumeMounts:
            - name: aws-token
              mountPath: /var/run/secrets/eks.amazonaws.com/serviceaccount
      volumes:
        - name: aws-token
          projected:
            sources:
              - serviceAccountToken:
                  audience: sts.amazonaws.com
                  expirationSeconds: 3600
```

#### IAM Policy for Backend Role

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudtrail:GetTrail",
                "cloudtrail:GetTrailStatus",
                "cloudtrail:LookupEvents",
                "cloudwatch:GetMetricData",
                "cloudwatch:ListMetrics",
                "cloudwatch:GetMetricStatistics",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:GetLogEvents"
            ],
            "Resource": "*"
        }
    ]
}
```

#### ECS Task Definition with IAM Roles

```json
{
    "family": "shipsec-studio",
    "taskRoleArn": "arn:aws:iam::123456789012:role/ShipSecTaskRole",
    "executionRoleArn": "arn:aws:iam::123456789012:role/ShipSecExecutionRole",
    "containerDefinitions": [
        {
            "name": "backend",
            "image": "shipsec/studio-backend:latest",
            "environment": [
                {
                    "name": "AWS_ROLE_ARN",
                    "value": "arn:aws:iam::123456789012:role/ShipSecTaskRole"
                }
            ]
        }
    ]
}
```

### 4. AWS Credentials File

Traditional AWS CLI-style configuration.

#### ~/.aws/credentials

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
aws_session_token = AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE/IvU1dYUg2RVAJBanLiHb4IgPzxj4XvrJOgQP0KM4T

[shipsec-studio]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = us-east-1
```

#### ~/.aws/config

```ini
[profile shipsec-studio]
region = us-east-1
output = json
```

### 5. AWS SSM Parameter Store

Secure credential management for production.

#### Store Credentials in SSM

```bash
# Store access key
aws ssm put-parameter --name "/shipsec/access-key" --value "AKIAIOSFODNN7EXAMPLE" --type "SecureString"

# Store secret key
aws ssm put-parameter --name "/shipsec/secret-key" --value "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" --type "SecureString"

# Store region
aws ssm put-parameter --name "/shipsec/region" --value "us-east-1" --type "String"
```

#### IAM Policy for SSM Access

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameters",
                "ssm:GetParameter"
            ],
            "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/shipsec/*"
        }
    ]
}
```

## Security Best Practices

### 1. Principle of Least Privilege

Create granular IAM policies with only required permissions.

#### CloudTrail Only Policy

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudtrail:GetTrail",
                "cloudtrail:GetTrailStatus",
                "cloudtrail:LookupEvents"
            ],
            "Resource": "*"
        }
    ]
}
```

#### CloudWatch Only Policy

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudwatch:GetMetricData",
                "cloudwatch:ListMetrics",
                "cloudwatch:GetMetricStatistics"
            ],
            "Resource": "*"
        }
    ]
}
```

### 2. Temporary Credentials

Always use temporary credentials with expiration.

```bash
# Get temporary credentials with 1 hour expiration
aws sts get-session-token --duration-seconds 3600

# Output example
{
    "Credentials": {
        "AccessKeyId": "ASIA...",
        "SecretAccessKey": "...",
        "SessionToken": "AQo...",
        "Expiration": "2024-01-01T12:00:00Z"
    }
}
```

### 3. Rotation Strategies

Implement automated credential rotation.

#### Using AWS IAM Rotation

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "iam:CreateAccessKey",
                "iam:DeleteAccessKey",
                "iam:CreateAccessKey",
                "iam:UpdateAccessKey"
            ],
            "Resource": "arn:aws:iam::123456789012:user/ShipSecUser"
        }
    ]
}
```

### 4. Environment Variables Security

```bash
# Use .env files with proper permissions
chmod 600 backend/.env

# Don't commit secrets to git
echo ".env" >> .gitignore

# Use secret management in CI/CD
```

## Monitoring and Auditing

### 1. CloudTrail Logging

Enable CloudTrail for all API calls made by ShipSec Studio.

#### CloudTrail Configuration

```json
{
    "Name": "ShipSecStudioTrail",
    "S3BucketName": "shipsec-cloudtrail-logs-123456789012",
    "IncludeServiceNames": [
        "cloudtrail",
        "cloudwatch",
        "logs"
    ],
    "IsMultiRegionTrail": true,
    "IsLogging": true
}
```

### 2. CloudWatch Metrics

Monitor credential usage and API calls.

#### CloudWatch Alarms

```json
{
    "AlarmName": "ShipSecAPIErrorRate",
    "MetricName": "Sum",
    "Namespace": "AWS/CloudTrail",
    "Statistic": "Sum",
    "Period": 300,
    "EvaluationPeriods": 2,
    "Threshold": 10,
    "ComparisonOperator": "GreaterThanThreshold",
    "Dimensions": [
        {
            "Name": "TrailName",
            "Value": "ShipSecStudioTrail"
        }
    ]
}
```

## Troubleshooting

### Common Issues

**Credential Denied**
```bash
# Check credentials
aws sts get-caller-identity

# Verify permissions
aws iam get-user --user-name ShipSecUser
```

**Region Mismatch**
```bash
# Check current region
aws configure get region

# Set correct region
aws configure set region us-east-1
```

**Network Connectivity**
```bash
# Test AWS connectivity
aws s3 ls s3://test-bucket

# Check VPC settings
aws ec2 describe-vpcs
```

### Debug Commands

```bash
# Test MCP server connectivity
curl -X GET "http://localhost:3000/api/v1/mcp-servers" -H "Content-Type: application/json"

# Check worker health
docker logs shipsec-studio-worker

# Verify backend configuration
bun --cwd backend run config:validate
```

## Example Implementations

### Development Environment

```bash
# .env.development
AWS_ACCESS_KEY_ID=dev-key
AWS_SECRET_ACCESS_KEY=dev-secret
AWS_REGION=us-east-1

# Justfile
dev:
  AWS_CONFIG_FILE=.env.development bun --cwd backend run dev
```

### Production Environment

```bash
# Kubernetes deployment with IRSA
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: shipsec-studio-sa
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/ShipSecStudioRole
EOF
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_REGION: us-east-1

steps:
  - name: Configure AWS Credentials
    uses: aws-actions/configure-aws-credentials@v1
    with:
      aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
      aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      aws-region: us-east-1
```

## References

- [AWS IAM Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/security-guide/latest/)
- [ShipSec Studio MCP Documentation](./mcp-library.md)
- [ShipSec Studio Architecture](https://docs.shipsec.ai)