# File Storage Implementation

## Overview

Real file storage system using MinIO (S3-compatible) with a complete file upload/download API and integration with the file loader component.

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend  │─────▶│  Files API   │─────▶│    MinIO     │
│             │      │  (Backend)   │      │   Storage    │
└─────────────┘      └──────────────┘      └──────────────┘
                            │                       
                            ▼                       
                     ┌──────────────┐              
                     │  PostgreSQL  │              
                     │  (Metadata)  │              
                     └──────────────┘              
                                                   
                     ┌──────────────┐              
                     │  Temporal    │              
                     │   Worker     │              
                     └──────────────┘              
                            │                       
                            ▼                       
                  ┌─────────────────────┐          
                  │  File Loader        │          
                  │  Component          │          
                  │  (fetches from      │          
                  │   MinIO)            │          
                  └─────────────────────┘          
```

## Components

### 1. MinIO Configuration (`storage/minio.config.ts`)
- Connects to MinIO server
- Auto-creates `shipsec-files` bucket
- Provides client access to other services

### 2. Storage Service (`storage/storage.service.ts`)
- **uploadFile()** - Upload files to MinIO with unique storage keys
- **downloadFile()** - Download files from MinIO
- **getFileMetadata()** - Get file stats without downloading
- **deleteFile()** - Remove files from storage

### 3. Files Repository (`storage/files.repository.ts`)
- Database operations for file metadata
- CRUD operations on `files` table
- Tracks: id, fileName, mimeType, size, storageKey, uploadedAt

### 4. Files Service (`storage/files.service.ts`)
- Coordinates StorageService + FilesRepository
- Handles file upload workflow:
  1. Upload to MinIO → get storageKey
  2. Save metadata to PostgreSQL → get file ID
  3. Return complete file record
- Ensures consistency between storage and database

### 5. Files Controller (`storage/files.controller.ts`)
REST API endpoints:
- `POST /files/upload` - Upload file (multipart/form-data)
- `GET /files` - List all uploaded files
- `GET /files/:id` - Get file metadata
- `GET /files/:id/download` - Download file content
- `DELETE /files/:id` - Delete file (from MinIO + DB)

### 6. File Loader Component (Updated)
**Before:** Mock component returning fake content
**Now:** Real component that:
- Takes `fileId` (UUID) as input
- Fetches file from MinIO via FilesService
- Returns file content as base64 + metadata
- Properly integrated with DI via service container

### 7. Service Container (`temporal/service-container.ts`)
- Dependency injection for Temporal worker
- Makes NestJS services available to components
- Initialized in worker startup with FilesService, StorageService

### 8. Database Schema
```sql
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size BIGINT NOT NULL,
  storage_key VARCHAR(500) NOT NULL UNIQUE,
  uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

## User Workflow

### 1. Upload File
```bash
curl -X POST http://localhost:3000/files/upload \
  -F "file=@myfile.txt"
```

**Response:**
```json
{
  "id": "ac56ba64-b502-4e2a-826b-27ea4a92ba96",
  "fileName": "myfile.txt",
  "mimeType": "text/plain",
  "size": 1024,
  "storageKey": "c31c99bc-474b-48ae-a340-ce1b66f9d3ad-myfile.txt",
  "uploadedAt": "2025-10-09T00:31:13.508Z"
}
```

### 2. Create Workflow with File Loader
```json
{
  "name": "Process File",
  "nodes": [
    {
      "id": "loader",
      "componentId": "core.file.loader",
      "params": {
        "fileId": "ac56ba64-b502-4e2a-826b-27ea4a92ba96"
      }
    },
    ...
  ]
}
```

### 3. Run Workflow
- Temporal worker executes file loader component
- Component fetches file from MinIO
- File content loaded into memory as base64
- Passed to next component in workflow

## Environment Variables

```env
# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_USE_SSL=false
```

## Testing

All endpoints tested and working:
- ✅ File upload to MinIO
- ✅ File metadata saved to PostgreSQL
- ✅ File list retrieval
- ✅ File download from MinIO
- ✅ Component registry updated with new schema
- ✅ Service injection in Temporal worker

## Future Enhancements

1. **S3 Loader Component** - Load from external S3 buckets
2. **File Size Limits** - Enforce max upload size
3. **File Type Validation** - Restrict allowed MIME types
4. **Pre-signed URLs** - Direct browser → MinIO uploads
5. **File Expiration** - Auto-cleanup of old files
6. **Chunked Uploads** - Support for large files
7. **File Processing** - Image resizing, PDF parsing, etc.

