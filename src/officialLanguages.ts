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

