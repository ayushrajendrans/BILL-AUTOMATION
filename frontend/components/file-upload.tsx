
"use client"

import { useCallback, useState } from "react"
import { useDropzone, type FileRejection } from "react-dropzone"
import { Upload, File, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface FileUploadProps {
    files: File[]
    onFilesSelected: (files: File[]) => void
    isProcessing: boolean
}

function fileKey(file: File) {
    return JSON.stringify([file.name, file.size, file.lastModified])
}

export function FileUpload({ files, onFilesSelected, isProcessing }: FileUploadProps) {
    const [error, setError] = useState("")

    const onDrop = useCallback((acceptedFiles: File[], rejected: FileRejection[]) => {
        const combined = new Map(files.map(file => [fileKey(file), file]))
        for (const file of acceptedFiles) combined.set(fileKey(file), file)
        onFilesSelected([...combined.values()])
        setError(rejected.length
            ? `${rejected.length} file${rejected.length === 1 ? " was" : "s were"} rejected. Select JPG, PNG or WEBP images.`
            : "")
    }, [files, onFilesSelected])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp']
        },
        disabled: isProcessing
    })

    const removeFile = (index: number) => {
        const newFiles = files.filter((_, i) => i !== index)
        onFilesSelected(newFiles)
    }

    return (
        <div className="w-full max-w-2xl mx-auto space-y-4">
            <div
                {...getRootProps({ role: "button", "aria-label": "Choose poster images", "aria-disabled": isProcessing })}
                className={cn(
                    "border-2 border-dashed rounded-lg p-5 sm:p-10 transition-colors cursor-pointer flex flex-col items-center justify-center gap-4 focus-visible:outline-2 focus-visible:outline-purple-400",
                    "backdrop-blur-sm",
                    isDragActive
                        ? "border-purple-500 bg-purple-500/10 shadow-[0_0_30px_rgba(168,85,247,0.2)]"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
                    isProcessing && "opacity-50 cursor-not-allowed"
                )}
            >
                <input {...getInputProps()} />
                <div className="p-4 bg-white/5 rounded-full ring-1 ring-white/10">
                    <Upload className="w-8 h-8 text-neutral-300" />
                </div>
                <div className="text-center space-y-1">
                    <p className="text-lg font-medium text-white">Drag & drop posters here</p>
                    <p className="text-sm text-neutral-400">
                        or click to select files (JPG, PNG, WEBP)
                    </p>
                </div>
            </div>

            {error && <p role="alert" className="text-sm text-red-200">{error}</p>}

            {files.length > 0 && (
                <Card>
                    <CardContent className="p-2 sm:p-4 space-y-2 max-h-60 overflow-y-auto">
                        {files.map((file, index) => (
                            <div key={fileKey(file)} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/50">
                                <div className="flex min-w-0 items-center gap-2">
                                    <File className="w-4 h-4 shrink-0 text-primary" />
                                    <span className="truncate text-sm font-medium" title={file.name}>{file.name}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    aria-label={`Remove ${file.name}`}
                                    title={`Remove ${file.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        removeFile(index)
                                    }}
                                    disabled={isProcessing}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
