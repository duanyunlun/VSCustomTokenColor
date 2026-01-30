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
    '/* Token Styler Preview (generic / TypeScript) */',
    '/*',
    '目标：覆盖大部分 LSP 标准 tokenType，并在附近用注释标注。C# 不包含/难以覆盖的（如 regexp/decorator）可在此文件观察。',
    'N/A: struct / macro',
    '*/',
    '',
    '// tokenType: namespace',
    'namespace TokenStylerPreview {',
    '  // tokenType: type / typeParameter',
    '  export type Box<T> = { value: T };',
    '',
    '  // tokenType: interface',
    '  export interface IGreeter {',
    '    greet(name: string): string; // tokenType: method / parameter / type',
    '  }',
    '',
    '  // tokenType: enum / enumMember',
    '  export enum ColorKind {',
    '    Red = 1,',
    '    Green = 2,',
    '    Blue = 3',
    '  }',
    '',
    '  // tokenType: class / property / method',
    '  export class Greeter implements IGreeter {',
    '    public constructor(private readonly userId: string) {} // tokenType: parameter / modifier',
    '',
    '    public greet(name: string): string {',
    '      // tokenType: variable / string / operator',
    '      const message = `Hello, ${name}! (${this.userId})`;',
    '',
    '      // tokenType: regexp (regex literal)',
    '      const r = /hello/i;',
    '      if (r.test(message)) { // tokenType: keyword',
    '        return message;',
    '      }',
    '      return "nope";',
    '    }',
    '  }',
    '',
    '  // tokenType: function',
    '  export function add(a: number, b: number): number {',
    '    return a + b; // tokenType: operator / number',
    '  }',
    '',
    '  // tokenType: decorator (TypeScript decorator syntax)',
    '  function deco(_target: any, _key?: string) {}',
    '  export class WithDecorator {',
    '    @deco',
    '    public value = 1;',
    '  }',
    '}',
    ''
  ].join('\n');
}

function getCSharpSnippet(): string {
  return [
    '// Token Styler Preview (C#)',
    '// 目标：尽可能覆盖常见 LSP 标准 tokenType，并在附近用注释标注「期望看到的 tokenType/selector」。',
    '// 注意：不同语言服务/版本的实际输出可能不同；请以 “Developer: Inspect Editor Tokens and Scopes” 为准。',
    '',
    'using System; // keyword / namespace / type（取决于服务实现）',
    '',
    '/*',
    'LSP 标准 tokenType 参考（本文件尽量覆盖；无法覆盖的会标 N/A）：',
    '- namespace / class / struct / interface / enum / enumMember',
    '- typeParameter / parameter / variable / property / event / method / function',
    '- keyword / modifier / comment / string / number / operator',
    '- macro (N/A in C#) / regexp (N/A in C#) / decorator (可能映射到 Attribute)',
    '*/',
    '',
    'namespace TokenStylerPreview // tokenType: namespace',
    '{',
    '    // tokenType: enum / enumMember',
    '    public enum ColorKind',
    '    {',
    '        Red = 1,',
    '        Green = 2,',
    '        Blue = 3',
    '    }',
    '',
    '    // tokenType: interface',
    '    public interface IGreeter',
    '    {',
    '        // tokenType: method / parameter / type',
    '        string Greet(string name);',
    '    }',
    '',
    '    // tokenType: struct',
    '    public readonly struct Point',
    '    {',
    '        // tokenType: property',
    '        public int X { get; }',
    '        public int Y { get; }',
    '',
    '        public Point(int x, int y) { X = x; Y = y; } // tokenType: method / parameter / number',
    '    }',
    '',
    '    // tokenType: class / typeParameter',
    '    public class Box<T> where T : class // selector 可能包含 typeParameter / modifier / keyword',
    '    {',
    '        // tokenType: field/variable（C# 往往是 variable + modifiers）',
    '        private readonly T _value;',
    '',
    '        // tokenType: method / parameter',
    '        public Box(T value) { _value = value; }',
    '',
    '        // tokenType: property',
    '        public T Value => _value;',
    '',
    '        // tokenType: event',
    '        public event EventHandler? Changed;',
    '',
    '        public void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty); // tokenType: method / operator',
    '    }',
    '',
    '    public static class Program // tokenType: class',
    '    {',
    '        // C# 常量：通常不是 tokenType=constant，而更可能是 tokenType=variable + modifier=readonly/static（以实际输出为准）',
    '        private const int MaxCount = 3; // 试试 selector: variable.readonly',
    '',
    '        [Obsolete(\"Preview attribute\")]', // decorator? (可能映射为 class/attribute)
    '        public static void Main(string[] args) // tokenType: method / parameter / string',
    '        {',
    '            // tokenType: comment',
    '            var p = new Point(1, 2); // tokenType: variable / number',
    '',
    '            // tokenType: string / operator',
    '            var message = $\"Hello #{p.X + p.Y}\";',
    '',
    '            // tokenType: keyword / operator',
    '            for (var i = 0; i < MaxCount; i++)',
    '            {',
    '                Console.WriteLine(message); // tokenType: method',
    '            }',
    '',
    '            // tokenType: function（local function）',
    '            int Add(int a, int b) => a + b;',
    '            _ = Add(1, 2);',
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
