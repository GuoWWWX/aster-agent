/** Kanban lays out tasks before accounting for the full column heading height. */
export function layoutMermaidKanban(root: SVGSVGElement): boolean {
  if (root.getAttribute("aria-roledescription") !== "kanban") return false;
  const columns = [...root.querySelectorAll<SVGGElement>(".sections > .cluster")].map(group => ({
    rect: group.querySelector<SVGRectElement>("rect"), label: group.querySelector<SVGGElement>(".cluster-label"),
  })).filter((column): column is { rect: SVGRectElement; label: SVGGElement } => column.rect !== null && column.label !== null);
  if (!columns.length) return false;
  for (const { label } of columns) {
    for (const row of label.querySelectorAll<SVGElement>("text,tspan.row")) {
      row.style.setProperty("text-anchor", "middle");
      row.setAttribute("x", "0");
    }
  }
  const headingHeight = Math.max(...columns.map(column => column.label.getBBox().height));
  const items = root.querySelector<SVGGElement>(".items");
  const firstItemTop = items?.querySelector(".node") ? items.getBBox().y : Infinity;
  for (const { rect, label } of columns) {
    const box = rect.getBBox(), heading = label.getBBox();
    const top = Math.min(box.y, firstItemTop - headingHeight - 24);
    rect.setAttribute("y", String(top));
    rect.setAttribute("height", String(box.height + box.y - top));
    label.setAttribute("transform", `translate(${box.x + (box.width - heading.width) / 2 - heading.x}, ${top + 12 - heading.y})`);
  }
  // Extend upwards without moving or shrinking any task cards.
  const view = root.viewBox.baseVal;
  const top = Math.min(view.y, root.getBBox().y - 16);
  root.setAttribute("viewBox", `${view.x} ${top} ${view.width} ${view.height + view.y - top}`);
  return true;
}

/** Preserve readable, complete relationship labels in both live SVG and Word images. */
export function styleMermaidEdgeLabels(root: SVGSVGElement, dark: boolean): void {
  // 同级分组按 SVG 绘制顺序覆盖；嵌套分组会覆盖外层分组底色。
  const clusters = Array.from(root.querySelectorAll<SVGRectElement>(".cluster > rect")).map((rect) => ({
    bounds: rect.getBoundingClientRect(), style: getComputedStyle(rect),
  }));
  for (const label of root.querySelectorAll<SVGGElement>("g.edgeLabel")) {
    const bounds = label.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    let rgb = dark ? [24, 24, 27] : [255, 255, 255];
    for (const cluster of clusters) {
      const b = cluster.bounds;
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
      const channels = cluster.style.fill.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) continue; // fill:none 不覆盖画布
      const alpha = (channels[3] ?? 1) * Number(cluster.style.fillOpacity) * Number(cluster.style.opacity);
      rgb = rgb.map((channel, i) => (channels[i] ?? 0) * alpha + channel * (1 - alpha));
    }
    const linear = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    const color = (luminance + 0.05) / 0.066 > 1.05 / (luminance + 0.05) ? "#222222" : "#f5f5f5";
    const background = `rgb(${rgb.map((channel) => Math.round(channel)).join(", ")})`;
    // 内联到文字本身，SVG 单独展示和 PNG 栅格化时也能保留，不依赖页面 CSS。
    for (const element of [label, ...label.querySelectorAll<SVGElement | HTMLElement>("div,span,p,text,tspan")]) {
      element.style.setProperty("color", color, "important");
      if (element.matches("text,tspan")) {
        element.style.setProperty("fill", color, "important");
        element.style.setProperty("stroke", background, "important");
        element.style.setProperty("stroke-width", "3px", "important");
        element.style.setProperty("paint-order", "stroke", "important");
      } else if (element.matches("div,span,p")) {
        element.style.setProperty("white-space", "normal", "important");
        element.style.setProperty("overflow-wrap", "anywhere", "important");
        element.style.setProperty("word-break", "break-word", "important");
        element.style.setProperty("line-height", "1.35", "important");
        element.style.setProperty("text-align", "center", "important");
        // foreignObject 文本没有 SVG stroke，用同色文字描边擦掉连线。
        element.style.setProperty("text-shadow", `1.5px 0 ${background}, -1.5px 0 ${background}, 0 1.5px ${background}, 0 -1.5px ${background}`, "important");
      }
    }

    // 如果连线标签内容较长发生换行，自动扩展 foreignObject 高度并向上补偿偏移以保持居中，避免文字被溢出切断
    for (const fo of label.querySelectorAll<SVGForeignObjectElement>("foreignObject")) {
      fo.style.setProperty("overflow", "visible", "important");
      const div = fo.querySelector("div, span, p");
      if (div) {
        const neededHeight = Math.ceil(div.scrollHeight);
        const currentHeight = parseFloat(fo.getAttribute("height") || "0");
        if (neededHeight > currentHeight && neededHeight > 0) {
          fo.setAttribute("height", String(neededHeight));
          const deltaY = (neededHeight - currentHeight) / 2;
          const foY = parseFloat(fo.getAttribute("y") || "0");
          fo.setAttribute("y", String(foY - deltaY));
        }
      }
    }
  }

}

export function contrastRatio(first: readonly number[], second: readonly number[]): number {
  const luminance = (channels: readonly number[]) => channels.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Keep semantic fills and readable custom colors; change only low-contrast ink. */
export function ensureMermaidContrast(root: SVGSVGElement, dark: boolean): void {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return;
  const colors = new Map<string, number[]>();
  const rgb = (color: string): number[] => {
    if (!colors.has(color)) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      colors.set(color, [...context.getImageData(0, 0, 1, 1).data]);
    }
    return colors.get(color)!;
  };
  const canvasColor = dark ? [32, 33, 36] : [255, 255, 255];
  const shapes = [...root.querySelectorAll("rect,polygon,circle,ellipse,path")].map(shape => {
    const style = getComputedStyle(shape);
    return { bounds: shape.getBoundingClientRect(), color: style.fill === "none" ? null : rgb(style.fill), opacity: Number(style.opacity) * Number(style.fillOpacity) };
  }).filter((shape): shape is typeof shape & { color: number[] } => shape.color !== null && Boolean(shape.color[3]) && Boolean(shape.bounds.width && shape.bounds.height && shape.opacity));
  const backgroundAt = (element: Element): number[] => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    let background = canvasColor;
    for (const shape of shapes) {
      const b = shape.bounds;
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
      const alpha = (shape.color[3] ?? 0) / 255 * shape.opacity;
      background = background.map((channel, index) => (shape.color[index] ?? 0) * alpha + channel * (1 - alpha));
    }
    return background;
  };
  const readableColor = (background: readonly number[]): string => contrastRatio([0, 0, 0], background) > contrastRatio([255, 255, 255], background) ? "#000000" : "#ffffff";
  const readableLineColor = (backgrounds: readonly number[][]): string => ["#000000", "#ffffff", "#777777"].sort((a, b) =>
    Math.min(...backgrounds.map(background => contrastRatio(rgb(b), background))) - Math.min(...backgrounds.map(background => contrastRatio(rgb(a), background))))[0]!;
  for (const text of root.querySelectorAll<SVGElement | HTMLElement>("text,tspan,.nodeLabel,.nodeLabel p,.nodeLabel span")) {
    if (!(text.textContent ?? "").trim()) continue;
    const property = text.matches("text,tspan") ? "fill" : "color";
    const color = getComputedStyle(text).getPropertyValue(property);
    if (color === "none") continue;
    const background = backgroundAt(text);
    if (contrastRatio(rgb(color), background) >= 4.5) continue;
    text.style.setProperty(property, readableColor(background), "important");
  }
  for (const line of root.querySelectorAll<SVGElement>(".flowchart-link,.edgePath path,.relation,.messageLine0,.messageLine1,.actor-line,.transition,.relationshipLine")) {
    const color = getComputedStyle(line).stroke;
    const bounds = line.getBoundingClientRect();
    const backgrounds = [canvasColor, ...shapes.filter(shape => {
      const b = shape.bounds;
      return b.right >= bounds.left && b.left <= bounds.right && b.bottom >= bounds.top && b.top <= bounds.bottom;
    }).map(shape => shape.color)];
    if (color !== "none" && backgrounds.some(background => contrastRatio(rgb(color), background) < 3)) {
      line.style.setProperty("stroke", readableLineColor(backgrounds), "important");
    }
  }
  for (const arrow of root.querySelectorAll<SVGElement>("marker path,marker polygon")) {
    for (const property of ["fill", "stroke"]) {
      const color = getComputedStyle(arrow).getPropertyValue(property);
      const backgrounds = [canvasColor, ...shapes.map(shape => shape.color)];
      if (color !== "none" && backgrounds.some(background => contrastRatio(rgb(color), background) < 3)) {
        arrow.style.setProperty(property, readableLineColor(backgrounds), "important");
      }
    }
  }
}
