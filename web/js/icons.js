// Station icons, drawn as simple line icons (24x24, stroke = currentColor).
// The keys match the check constraint on healthy_athletes.stations.icon.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  tooth: ["M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7 .5 2.5 1 6.5 2.8 6.5 1.6 0 1.7-4.5 4.2-4.5s2.6 4.5 4.2 4.5c1.8 0 2.3-4 2.8-6.5.5-2.5 2-4 2-7C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"],
  ear: ["M6 9a6 6 0 1 1 12 0c0 3-2 4.5-3 5.5s-1 2.5-1 3.5a3 3 0 0 1-6 0", "M9.5 9a2.5 2.5 0 1 1 5 0c0 1.5-1.5 2-1.5 3"],
  foot: ["M8 21c-2.5 0-3.5-2-3.5-4.5S6 11 6 8.5 7 5 9 5s2.5 2 2.5 4-1 4.5-1 7 .5 5-2.5 5z", "M14 4.5h.01", "M16.5 5.5h.01", "M18.5 7.5h.01", "M19.5 10h.01", "M13 7.5c1.5 0 2 1 2 2"],
  heart: ["M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20 9.5C20 15.4 12 20 12 20z"],
  run: ["M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0", "M7 21l3-6 3 2v4", "M6 11l3-3 4 1 2 3 3 1", "M10 15l2-6"],
  mind: ["M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1z", "M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"],
  apple: ["M12 7c-1.5-1-3-1.5-4.5-1C5 6.5 4 9 4 11.5 4 16 7 21 9.5 21c1 0 1.5-.5 2.5-.5s1.5.5 2.5.5C17 21 20 16 20 11.5 20 9 19 6.5 16.5 6c-1.5-.5-3 0-4.5 1z", "M12 7c0-2 1-3.5 3-4"],
  stethoscope: ["M5 3v6a5 5 0 0 0 10 0V3", "M10 14v2a5 5 0 0 0 10 0v-3", "M20 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  star: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"],
};

/** Choices for the organiser's station form: [key, label]. */
export const ICON_CHOICES = [
  ["eye", "Eye"], ["tooth", "Tooth"], ["ear", "Ear"], ["foot", "Foot"],
  ["run", "Running figure"], ["heart", "Heart"], ["mind", "Mind"],
  ["apple", "Apple"], ["stethoscope", "Stethoscope"], ["star", "Star"],
];

/** An <svg> element for the icon (falls back to the star). */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name] ?? PATHS.star) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
