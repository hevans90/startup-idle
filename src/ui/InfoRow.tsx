export const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="w-full flex items-center gap-3 justify-between">
    <span className="responsive-text-xs grow text-primary-700 dark:text-primary-300">
      {label}
    </span>
    <span className="responsive-text-xs">{value}</span>
  </div>
);
