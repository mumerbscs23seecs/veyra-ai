import "./globals.css";

export const metadata = {
  title: "Veyra AI",
  description: "Veyra AI — powered by Cerebras + LangChain with weather, web search, PDF analysis, and more",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full" suppressHydrationWarning>{children}</body>
    </html>
  );
}
