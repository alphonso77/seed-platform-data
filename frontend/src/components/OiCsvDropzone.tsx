import { useState } from 'react';

interface Props {
  onUpload: (file: File) => void;
  isLoading: boolean;
}

export function OiCsvDropzone({ onUpload, isLoading }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.toLowerCase().endsWith('.csv')) {
      setFile(dropped);
    }
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
          dragOver
            ? 'border-teal-500 bg-teal-500/5'
            : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600'
        }`}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {file ? file.name : 'Drop OI result CSV here, or click to browse'}
        </div>
        {file && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {(file.size / 1024).toFixed(1)} KB
          </div>
        )}
      </label>

      <button
        type="button"
        disabled={!file || isLoading}
        onClick={() => file && onUpload(file)}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? 'Uploading…' : 'Upload CSV'}
      </button>
    </div>
  );
}
