// The prompts in prompts/*.md are imported as plain text:
//   import tidy from "../../prompts/tidy.md" with { type: "text" };
// Bun embeds them in the compiled binary; this tells TypeScript they are strings.
declare module "*.md" {
  const text: string;
  export default text;
}
