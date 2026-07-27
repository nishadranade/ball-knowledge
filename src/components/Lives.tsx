interface Props {
  max: number;
  left: number;
}

/** Simple hearts-style lives indicator. */
export function Lives({ max, left }: Props) {
  return (
    <div className="lives" aria-label={`${left} of ${max} guesses left`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < left ? 'life' : 'life lost'}>
          {i < left ? '●' : '○'}
        </span>
      ))}
      <span className="lives-label">{left} left</span>
    </div>
  );
}
