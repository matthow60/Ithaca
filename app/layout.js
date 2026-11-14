import './globals.css';

export const metadata = {
  title: 'Incident Command Center',
  description: 'Live crash → Grok patch → GitHub PR dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
