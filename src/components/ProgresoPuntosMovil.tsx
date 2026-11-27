export default function ProgresoPuntosMovil({ total, paso }: { total: number; paso: number }) {
  return (
    <div className="flex justify-center gap-2 mb-6" role="progressbar" aria-label={`Paso ${paso + 1} de ${total}`} aria-valuemin={1} aria-valuemax={total} aria-valuenow={paso + 1}>
      {Array.from({ length: total }, (_, index) => (
        <div key={index} className="h-2 rounded-full transition-all duration-300" style={{ width: index <= paso ? 28 : 12, background: index <= paso ? 'var(--brand-primary)' : 'var(--border-default)' }} />
      ))}
    </div>
  );
}
