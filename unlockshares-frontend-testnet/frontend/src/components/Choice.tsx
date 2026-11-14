import type { LucideIcon } from 'lucide-react'

// Choix entre plusieurs « guichets » : de grandes tuiles, une seule active. Un seul niveau de texte : titre + une ligne.
export type ChoiceOption<T extends string> = { id: T; icon: LucideIcon; title: string; sub: string; tag?: string }

export function Choice<T extends string>({ options, value, onChange, label }: { options: ChoiceOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="co-choice" role="radiogroup" aria-label={label}>
      {options.map(({ id, icon: Icon, title, sub, tag }) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          <Icon className="co-choice-ic" aria-hidden />
          <span><b>{title}</b><small>{sub}</small></span>
          {tag && <span className="tag">{tag}</span>}
        </button>
      ))}
    </div>
  )
}
