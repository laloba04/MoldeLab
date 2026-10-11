import { useState } from 'react';
import { DEFAULTS, type Params } from '../types';
import { deletePreset, loadPresets, upsertPreset, type Preset } from '../lib/presets';

/** Ajustes guardados con nombre, para reutilizar una configuración. */
export function Presets({ params, cargar }: { params: Params; cargar: (p: Params) => void }) {
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [nombre, setNombre] = useState('');

  const guardar = () => {
    if (!nombre.trim()) return;
    setPresets(upsertPreset(nombre, params));
    setNombre('');
  };

  return (
    <div className="presets">
      <h3>Ajustes guardados</h3>
      <div className="preset-save">
        <input
          type="text"
          value={nombre}
          maxLength={30}
          placeholder="Nombre del ajuste…"
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') guardar();
          }}
        />
        <button className="mini" disabled={!nombre.trim()} onClick={guardar}>
          Guardar
        </button>
      </div>
      {presets.length > 0 ? (
        <ul className="preset-list">
          {presets.map((pr) => (
            <li key={pr.name}>
              <button
                className="preset-load"
                title="Cargar este ajuste"
                onClick={() => cargar({ ...DEFAULTS, ...pr.params })}
              >
                {pr.name}
              </button>
              <button
                className="preset-del"
                title="Borrar"
                onClick={() => setPresets(deletePreset(pr.name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Guarda la configuración actual con un nombre para reutilizarla.</p>
      )}
    </div>
  );
}
