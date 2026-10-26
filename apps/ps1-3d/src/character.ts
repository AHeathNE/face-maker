import * as THREE from 'three';

/**
 * A character is a root group with named attachment points ("anchors") and named equipment slots.
 * Today only the head exists. The body, clothing and poses plug in here without touching the head code:
 *
 *  - body:     a mesh/skeleton set with `anchors.neck` where the head attaches
 *  - clothing: wearables registered per slot ('torso', 'legs', 'feet', 'hands', 'hat', ...)
 *  - pose:     a function/clip that rotates the anchors' bones (applied to `root` every frame)
 */
export type SlotName = 'head' | 'hair' | 'body' | 'torso' | 'legs' | 'feet' | 'hands' | 'hat';

export interface Wearable {
  id: string;
  slot: SlotName;
  label: string;
  /** build the object to attach; called whenever the wearable is equipped */
  build(): THREE.Object3D;
}

export class Character {
  readonly root = new THREE.Group();
  /** where things attach; the body will move/animate these */
  readonly anchors: Record<'neck' | 'handL' | 'handR' | 'origin', THREE.Object3D> = {
    origin: new THREE.Object3D(),
    neck: new THREE.Object3D(),
    handL: new THREE.Object3D(),
    handR: new THREE.Object3D(),
  };
  private equipped = new Map<SlotName, THREE.Object3D>();

  constructor() {
    this.root.add(this.anchors.origin);
    this.anchors.origin.add(this.anchors.neck);
  }

  /** Put an object in a slot, replacing and disposing whatever was there. Slots attach to the neck for now. */
  setSlot(slot: SlotName, obj: THREE.Object3D | null) {
    const old = this.equipped.get(slot);
    if (old) { old.removeFromParent(); disposeTree(old); this.equipped.delete(slot); }
    if (obj) { this.anchors.neck.add(obj); this.equipped.set(slot, obj); }
  }

  equip(w: Wearable) { this.setSlot(w.slot, w.build()); }
  getSlot(slot: SlotName) { return this.equipped.get(slot); }
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}
