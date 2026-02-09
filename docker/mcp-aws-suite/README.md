# AWS Suite MCP Docker Image

This Docker image contains multiple AWS-related MCP (Model Context Protocol) servers bundled together for easy deployment and testing.

## Included MCP Servers

- **awslabs.cloudtrail-mcp-server** - AWS CloudTrail integration
- **awslabs.cloudwatch-mcp-server** - AWS CloudWatch integration
- **awslabs.ec2-mcp-server** - AWS EC2 integration
- **awslabs.s3-mcp-server** - AWS S3 integration

## Usage

### Building the Image

```bash
docker build -t shipsec/mcp-aws-suite:latest .
```

### Running the Container

With default settings (CloudTrail):

```bash
docker run -p 8080:8080 shipsec/mcp-aws-suite:latest
```

With different MCP server:

```bash
docker run -e MCP_COMMAND=awslabs.cloudwatch-mcp-server -p 8080:8080 shipsec/mcp-aws-suite:latest
```

With custom arguments:

```bash
docker run -e MCP_COMMAND=awslabs.cloudtrail-mcp-server -e MCP_ARGS='["--region", "us-west-2"]' -p 8080:8080 shipsec/mcp-aws-suite:latest
```

### Environment Variables

- `MCP_COMMAND` (required): The MCP server to run. Defaults to `awslabs.cloudtrail-mcp-server`
- `MCP_ARGS` (optional): JSON array of command arguments
- `PORT`: HTTP port for the stdio proxy (defaults to 8080)

### Health Check

The container exposes a health check endpoint at `/health`:

```bash
curl http://localhost:8080/health
```

### AWS Credentials

To use the AWS MCP servers, you'll need to provide AWS credentials. You can mount them:

```bash
docker run -v ~/.aws/credentials:/root/.aws/credentials:ro -e AWS_PROFILE=default -p 8080:8080 shipsec/mcp-aws-suite:latest
```

or set environment variables:

```bash
docker run -e AWS_ACCESS_KEY_ID=your_access_key -e AWS_SECRET_ACCESS_KEY=your_secret_key -p 8080:8080 shipsec/mcp-aws-suite:latest
```
