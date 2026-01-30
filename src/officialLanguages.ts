export type OfficialLanguage = {
  key: string;
  label: string;
  languageId: string;
  recommendedExtensionId: string;
};

// 仅收录常见且有“官方/事实标准”语义 token 支持的语言扩展（可扩展）。
export const OFFICIAL_LANGUAGES: readonly OfficialLanguage[] = [
  {
    key: 'csharp',
    label: 'C#',
    languageId: 'csharp',
    recommendedExtensionId: 'ms-dotnettools.csharp'
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    languageId: 'typescript',
    // VS Code 内置
    recommendedExtensionId: 'vscode.typescript-language-features'
  },
  {
    key: 'javascript',
    label: 'JavaScript',
    languageId: 'javascript',
    // VS Code 内置
    recommendedExtensionId: 'vscode.typescript-language-features'
  },
  {
    key: 'json',
    label: 'JSON',
    languageId: 'json',
    // VS Code 内置
    recommendedExtensionId: 'vscode.json-language-features'
  },
  {
    key: 'html',
    label: 'HTML',
    languageId: 'html',
    // VS Code 内置
    recommendedExtensionId: 'vscode.html-language-features'
  },
  {
    key: 'css',
    label: 'CSS',
    languageId: 'css',
    // VS Code 内置
    recommendedExtensionId: 'vscode.css-language-features'
  },
  {
    key: 'java',
    label: 'Java',
    languageId: 'java',
    recommendedExtensionId: 'redhat.java'
  },
  {
    key: 'cpp',
    label: 'C/C++',
    languageId: 'cpp',
    recommendedExtensionId: 'ms-vscode.cpptools'
  },
  {
    key: 'python',
    label: 'Python',
    languageId: 'python',
    recommendedExtensionId: 'ms-python.python'
  },
  {
    key: 'php',
    label: 'PHP',
    languageId: 'php',
    recommendedExtensionId: 'bmewburn.vscode-intelephense-client'
  },
  {
    key: 'yaml',
    label: 'YAML',
    languageId: 'yaml',
    recommendedExtensionId: 'redhat.vscode-yaml'
  },
  {
    key: 'ruby',
    label: 'Ruby',
    languageId: 'ruby',
    recommendedExtensionId: 'Shopify.ruby-lsp'
  },
  {
    key: 'dart',
    label: 'Dart',
    languageId: 'dart',
    recommendedExtensionId: 'Dart-Code.dart-code'
  },
  {
    key: 'go',
    label: 'Go',
    languageId: 'go',
    recommendedExtensionId: 'golang.go'
  },
  {
    key: 'rust',
    label: 'Rust',
    languageId: 'rust',
    recommendedExtensionId: 'rust-lang.rust-analyzer'
  }
];
