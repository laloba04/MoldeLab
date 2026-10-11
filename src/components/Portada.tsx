import { Image as ImageIcon } from 'lucide-react';
import { TEMPLATES, templatePreview, type Template } from '../lib/templates';

/** Lo que se ve antes de subir nada: subir imagen o empezar con una forma. */
export function Portada({ elegir, plantilla }: { elegir: () => void; plantilla: (t: Template) => void }) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <span className="empty-eyebrow">Taller de moldes 3D</span>
        <h2>
          Suelta un dibujo.
          <br />
          Sale un molde.
        </h2>
        <p>
          Trazo negro sobre fondo blanco, o un PNG con transparencia. Cuanto más limpio el dibujo,
          más limpio el filo.
        </p>
        <button className="primary" onClick={elegir}>
          <ImageIcon size={16} /> Elegir imagen
        </button>

        <div className="tpl-intro">o empieza con una forma</div>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => plantilla(t)} title={t.label}>
              <img src={templatePreview(t)} alt="" aria-hidden />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
