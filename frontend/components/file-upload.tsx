
"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Upload, File, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface FileUploadProps {
    onFilesSelected: (files: File[]) => void
    isProcessing: boolean
}

export function FileUpload({ onFilesSelected, isProcessing }: FileUploadProps) {
    const [files, setFiles] = useState<File[]>([])

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setFiles((prev) => [...prev, ...acceptedFiles])
        onFilesSelected([...files, ...acceptedFiles])
    }, [files, onFilesSelected])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
            'application/zip': ['.zip']
        },
        disabled: isProcessing
    })

    const removeFile = (index: number) => {
        const newFiles = files.filter((_, i) => i !== index)
        setFiles(newFiles)
        onFilesSelected(newFiles)
    }

    return (
        <div className="w-full max-w-2xl mx-auto space-y-4">
            <div
                {...getRootProps()}
                className={cn(
                    "border-2 border-dashed rounded-xl p-10 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98]",
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
                        or click to select files (JPG, PNG, WEBP, ZIP)
                    </p>
                </div>
            </div>

            {files.length > 0 && (
                <Card>
                    <CardContent className="p-4 space-y-2 max-h-60 overflow-y-auto">
                        {files.map((file, index) => (
                            <div key={index} className="flex items-center justify-between p-2 rounded bg-muted/50">
                                <div className="flex items-center gap-3">
                                    <File className="w-4 h-4 text-primary" />
                                    <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
