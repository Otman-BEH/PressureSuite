import { NumberField, Segmented } from './ui'

/** Thin vessel wall, shared by the stored energy and hydrostatic test tools (API: WallIn). */
export interface WallSpec {
  shape: 'cylinder' | 'sphere'
  innerDiameterMm: number
  thicknessMm: number
  youngsModulusGpa: number
  poisson: number
}

export const DEFAULT_WALL: WallSpec = { shape: 'cylinder', innerDiameterMm: 300, thicknessMm: 8, youngsModulusGpa: 200, poisson: 0.3 }

export function wallPayload(w: WallSpec) {
  return {
    shape: w.shape,
    inner_diameter_mm: w.innerDiameterMm,
    thickness_mm: w.thicknessMm,
    youngs_modulus_gpa: w.youngsModulusGpa,
    poisson: w.poisson,
  }
}

export function WallFields({ wall, onChange }: { wall: WallSpec; onChange: (w: WallSpec) => void }) {
  const set = (patch: Partial<WallSpec>) => onChange({ ...wall, ...patch })
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Shape"
        value={wall.shape}
        onChange={(shape) => set({ shape })}
        options={[
          { value: 'cylinder', label: 'Cylinder', title: 'Closed-end thin cylinder; heads ignored' },
          { value: 'sphere', label: 'Sphere' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Inner diameter" unit="mm" value={wall.innerDiameterMm} min={1} max={100000} digits={1} onChange={(v) => set({ innerDiameterMm: v })} />
        <NumberField label="Wall thickness" unit="mm" value={wall.thicknessMm} min={0.01} max={10000} digits={2} onChange={(v) => set({ thicknessMm: v })} />
        <NumberField
          label="Young's modulus"
          unit="GPa"
          value={wall.youngsModulusGpa}
          min={0.1}
          max={2000}
          digits={1}
          title="Steel ≈ 200, aluminium ≈ 70"
          onChange={(v) => set({ youngsModulusGpa: v })}
        />
        <NumberField label="Poisson's ratio" value={wall.poisson} min={0} max={0.49} digits={2} onChange={(v) => set({ poisson: v })} />
      </div>
    </div>
  )
}
