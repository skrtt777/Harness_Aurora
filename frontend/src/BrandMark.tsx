/**
 * Substitui o wordmark em PNG (gradiente cromado + glow) por um lockup
 * plano em SVG/texto — mesma paleta de marca (teal), sem o acabamento
 * "3D brilhante" apontado na auditoria de UI.
 */
export default function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark">
      <span className="brand-mark-badge">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 17c2.6-6.4 4.8-9.6 8-9.6s5.4 3.2 8 9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M4 20c2.6-5.3 4.8-8 8-8s5.4 2.7 8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.5" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-mark-text">
          AURORA
          <small>Harness</small>
        </span>
      )}
    </div>
  );
}
