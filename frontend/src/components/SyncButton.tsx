import { type FC } from 'react';

type SyncState = 'idle' | 'loading' | 'success' | 'error';

interface SyncButtonProps {
  onSync: () => void | Promise<void>;
  state: SyncState;
  disabled?: boolean;
  label?: string;
}

const LABELS: Record<SyncState, string> = {
  idle:    '[ SYNC TO ORACLE ]',
  loading: '[ BROADCASTING... ]',
  success: '[ CONFIRMED ]',
  error:   '[ TX FAILED — RETRY ]',
};

const COLORS: Record<SyncState, string> = {
  idle:    'var(--neon-green)',
  loading: 'var(--neon-cyan)',
  success: 'var(--neon-green)',
  error:   'var(--neon-red)',
};

const SyncButton: FC<SyncButtonProps> = ({
  onSync,
  state,
  disabled = false,
  label,
}) => {
  const color = COLORS[state];
  const isDisabled = disabled || state === 'loading';

  const handleClick = () => {
    console.log('Sync button clicked');
    onSync();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      style={{
        ...styles.button,
        color,
        borderColor: color,
        boxShadow: isDisabled
          ? 'none'
          : `0 0 12px ${color}40, inset 0 0 12px ${color}08`,
        opacity: isDisabled && state !== 'loading' ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
      }}
    >
      {/* Left bracket decoration */}
      <span style={{ ...styles.bracket, color }}>▶</span>

      {/* Spinner */}
      {state === 'loading' && (
        <span style={{ ...styles.spinner, borderTopColor: color }} />
      )}

      {/* Success tick */}
      {state === 'success' && (
        <span style={{ ...styles.icon, color }}>✓</span>
      )}

      {/* Error X */}
      {state === 'error' && (
        <span style={{ ...styles.icon, color }}>✗</span>
      )}

      <span style={styles.text}>
        {label ?? LABELS[state]}
      </span>
    </button>
  );
};

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    background: 'transparent',
    border: '1px solid',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 24px',
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    transition: 'var(--transition)',
    outline: 'none',
    position: 'relative',
    overflow: 'hidden',
    minWidth: 220,
    justifyContent: 'center',
  },
  bracket: {
    fontSize: 8,
    lineHeight: 1,
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid transparent',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  icon: {
    fontSize: 14,
    fontWeight: 900,
    lineHeight: 1,
    flexShrink: 0,
  },
  text: {
    letterSpacing: '0.18em',
  },
};

export default SyncButton;
