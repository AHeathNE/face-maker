import Konva from 'konva';
import { layerDrawable, SHADOW, type FaceDoc, type Layer, type RenderStyle } from '@face-maker/face-core';

type ImageOf = (partId: string) => HTMLImageElement | undefined;

/** Konva view over a FaceDoc. The doc is the source of truth; this mutates it in place on drag/transform. */
export class Editor {
  readonly stage: Konva.Stage;
  private layer = new Konva.Layer();
  private tr = new Konva.Transformer({
    rotateEnabled: true, keepRatio: true, rotationSnaps: [0, 90, 180, 270], rotationSnapTolerance: 4,
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    anchorSize: 11, anchorCornerRadius: 6, borderStroke: '#6fcf97', anchorStroke: '#6fcf97', anchorFill: '#18181b', rotateAnchorOffset: 26,
  });
  doc: FaceDoc;
  selectedId: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onEdit: () => void = () => {};

  constructor(private container: HTMLElement, doc: FaceDoc, private imageOf: ImageOf, private getStyle: () => RenderStyle) {
    this.doc = doc;
    this.stage = new Konva.Stage({ container, width: container.clientWidth, height: container.clientWidth });
    this.stage.add(this.layer);
    this.layer.add(this.tr);
    this.stage.on('mousedown touchstart', (e) => { if (e.target === this.stage) this.select(null); });
    new ResizeObserver(() => this.fit()).observe(container);
    this.fit();
  }

  private fit() {
    const w = this.container.clientWidth;
    if (!w) return;
    this.stage.size({ width: w, height: w });
    this.layer.scale({ x: w / this.doc.size, y: w / this.doc.size });
  }

  setDoc(doc: FaceDoc, keepSelection = false) {
    this.doc = doc;
    if (!keepSelection || !doc.layers.some((l) => l.id === this.selectedId)) this.selectedId = null;
    this.fit();
    this.rebuild();
    this.onSelect(this.selectedId);
  }

  rebuild() {
    this.layer.find('.part').forEach((n) => n.destroy());
    const style = this.getStyle();
    for (const l of this.doc.layers) {
      const img = this.imageOf(l.partId);
      if (!img) continue;
      const d = layerDrawable(l, img, style);
      const node = new Konva.Image({
        id: l.id, name: 'part', image: d.canvas, x: l.x, y: l.y, width: d.width, height: d.height,
        offsetX: d.width / 2, offsetY: d.height / 2, rotation: l.rotation, draggable: true, perfectDrawEnabled: false,
      });
      if (style.shadow) node.setAttrs({ shadowColor: SHADOW.color, shadowOffset: { x: SHADOW.dx, y: SHADOW.dy }, shadowBlur: 0, shadowOpacity: 1 });
      node.on('mousedown touchstart', () => this.select(l.id));
      node.on('dragend', () => { l.x = node.x(); l.y = node.y(); this.onEdit(); });
      node.on('transformend', () => {
        l.w *= node.scaleX(); l.x = node.x(); l.y = node.y(); l.rotation = node.rotation();
        this.rebuild(); this.onEdit();
      });
      this.layer.add(node);
    }
    this.tr.moveToTop();
    this.syncTransformer();
  }

  select(id: string | null) {
    this.selectedId = id;
    this.syncTransformer();
    this.onSelect(id);
  }

  private syncTransformer() {
    const node = this.selectedId ? this.layer.findOne(`#${this.selectedId}`) : null;
    this.tr.nodes(node ? [node] : []);
    this.tr.moveToTop();
  }

  get selected(): Layer | undefined { return this.doc.layers.find((l) => l.id === this.selectedId); }
}
