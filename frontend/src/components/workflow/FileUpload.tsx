import { Upload, File, X, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/services/api'

interface FileUploadProps {
  onFileUploaded?: (fileId: string, fileName: string) => void
}

export function FileUpload({ onFileUploaded }: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setUploadedFileId(null)
      setError(null)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setError(null)

    try {
      const result = await api.files.upload(selectedFile)
      const fileId = (result as any).id
      
      setUploadedFileId(fileId)
      onFileUploaded?.(fileId, selectedFile.name)
    } catch (err) {
      console.error('Failed to upload file:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setIsUploading(false)
    }
  }

  const handleClear = () => {
    setSelectedFile(null)
    setUploadedFileId(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed border-muted rounded-lg p-6">
        {!selectedFile ? (
          <div className="text-center">
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold mb-2">Upload a file</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Select a file to upload for use in your workflow
            </p>
            <label htmlFor="file-input">
              <Button variant="outline" size="sm" asChild>
                <span>Choose File</span>
              </Button>
            </label>
            <input
              id="file-input"
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <File className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {!uploadedFileId ? (
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </>
                )}
              </Button>
            ) : (
              <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
                <p className="text-sm text-green-700 dark:text-green-400">
                  ✓ Uploaded successfully!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  File ID: {uploadedFileId}
                </p>
              </div>
            )}

            {error && (
              <div className="mt-2 text-center p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

