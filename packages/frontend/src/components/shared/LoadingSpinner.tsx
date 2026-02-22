export default function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`} role="status" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    </div>
  );
}
