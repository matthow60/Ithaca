import { Cormorant_Garamond, JetBrains_Mono, Outfit } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font (no requests to Google from the browser).
const display = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-display' });
const body = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata = {
  title: 'Incident Command Center',
  description: 'Live crash → Gemini patch → GitHub PR dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
