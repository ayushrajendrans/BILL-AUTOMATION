import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClubBill AI",
  description: "Automated nightclub billing extraction tool.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="antialiased">
        {children}
      </body>
    </html>
  );
}
