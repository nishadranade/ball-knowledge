import { useState, type FormEvent } from 'react';

interface Props {
  disabled?: boolean;
  onGuess: (value: string) => void;
  placeholder?: string;
}

export function GuessInput({ disabled, onGuess, placeholder }: Props) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onGuess(v);
    setValue('');
  };

  return (
    <form className="guess-input" onSubmit={submit}>
      <input
        type="text"
        autoFocus
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Type a surname…'}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Your guess"
      />
      <button type="submit" disabled={disabled}>
        Guess
      </button>
    </form>
  );
}
