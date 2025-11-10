# Test Credentials

For quick testing, default admin credentials are configured:

- **Username**: `admin`
- **Password**: `admin`

These are set as defaults in `backend/src/config/auth.config.ts`. 

To override with your own credentials, set environment variables:
```bash
export ADMIN_USERNAME=your-username
export ADMIN_PASSWORD=your-password
```

**⚠️ Change these defaults before deploying to production!**

