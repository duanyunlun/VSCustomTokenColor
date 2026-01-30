export type PreviewLanguageKey = 'csharp' | 'java' | 'cpp' | 'python' | 'go' | 'rust' | 'generic';

export function getPreviewFileExtension(languageKey: PreviewLanguageKey): string {
  switch (languageKey) {
    case 'csharp':
      return 'cs';
    case 'java':
      return 'java';
    case 'cpp':
      return 'cpp';
    case 'python':
      return 'py';
    case 'go':
      return 'go';
    case 'rust':
      return 'rs';
    default:
      return 'ts';
  }
}

export function getPreviewContent(languageKey: PreviewLanguageKey): string {
  switch (languageKey) {
    case 'csharp':
      return getCSharpSnippet();
    case 'java':
      return getJavaSnippet();
    case 'cpp':
      return getCppSnippet();
    case 'python':
      return getPythonSnippet();
    case 'go':
      return getGoSnippet();
    case 'rust':
      return getRustSnippet();
    default:
      return getGenericSnippet();
  }
}

function getGenericSnippet(): string {
  return [
    '/* Token Styler Preview (generic) */',
    '',
    'type UserId = string;',
    '',
    'export class Greeter {',
    '  public constructor(private readonly userId: UserId) {}',
    '',
    '  public greet(name: string): string {',
    '    const message = `Hello, ${name}!`; // string template',
    '    return message;',
    '  }',
    '}',
    ''
  ].join('\n');
}

function getCSharpSnippet(): string {
  return [
    '// Token Styler Preview (C#)',
    '',
    'using System;',
    '',
    'namespace TokenStylerPreview',
    '{',
    '    public static class Program',
    '    {',
    '        private const int MaxCount = 3;',
    '',
    '        public static void Main(string[] args)',
    '        {',
    '            for (var i = 0; i < MaxCount; i++)',
    '            {',
    '                Console.WriteLine($\"Hello #{i}\");',
    '            }',
    '        }',
    '    }',
    '}',
    ''
  ].join('\n');
}

function getJavaSnippet(): string {
  return [
    '// Token Styler Preview (Java)',
    '',
    'package tokenstyler.preview;',
    '',
    'public class Main {',
    '    private static final int MAX_COUNT = 3;',
    '',
    '    public static void main(String[] args) {',
    '        for (int i = 0; i < MAX_COUNT; i++) {',
    '            System.out.println(\"Hello #\" + i);',
    '        }',
    '    }',
    '}',
    ''
  ].join('\n');
}

function getCppSnippet(): string {
  return [
    '// Token Styler Preview (C/C++)',
    '',
    '#include <iostream>',
    '',
    'int main() {',
    '    const int maxCount = 3;',
    '    for (int i = 0; i < maxCount; i++) {',
    '        std::cout << \"Hello #\" << i << std::endl;',
    '    }',
    '    return 0;',
    '}',
    ''
  ].join('\n');
}

function getPythonSnippet(): string {
  return [
    '# Token Styler Preview (Python)',
    '',
    'MAX_COUNT = 3',
    '',
    'def main() -> None:',
    '    for i in range(MAX_COUNT):',
    '        print(f\"Hello #{i}\")',
    '',
    'if __name__ == \"__main__\":',
    '    main()',
    ''
  ].join('\n');
}

function getGoSnippet(): string {
  return [
    '// Token Styler Preview (Go)',
    '',
    'package main',
    '',
    'import \"fmt\"',
    '',
    'func main() {',
    '    const maxCount = 3',
    '    for i := 0; i < maxCount; i++ {',
    '        fmt.Printf(\"Hello #%d\\n\", i)',
    '    }',
    '}',
    ''
  ].join('\n');
}

function getRustSnippet(): string {
  return [
    '// Token Styler Preview (Rust)',
    '',
    'fn main() {',
    '    const MAX_COUNT: i32 = 3;',
    '    for i in 0..MAX_COUNT {',
    '        println!(\"Hello #{}\", i);',
    '    }',
    '}',
    ''
  ].join('\n');
}

