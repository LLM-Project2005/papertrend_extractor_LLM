/*
 * geist/font/sans and geist/font/mono for rendering the root layout outside
 * a Next build, where next/font/local has nothing to load: each font is the
 * class name of its CSS variable, as the real one gives the layout.
 */
export const GeistSans = { variable: "geist-sans-variable", className: "geist-sans", style: { fontFamily: "Geist" } };
export const GeistMono = { variable: "geist-mono-variable", className: "geist-mono", style: { fontFamily: "Geist Mono" } };
