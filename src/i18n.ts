import * as vscode from 'vscode';

export type UiLanguage = 'zh-cn' | 'en';

export function getUiLanguage(): UiLanguage {
  const lang = vscode.env.language.toLowerCase();
  if (lang === 'zh-cn' || lang.startsWith('zh-cn')) {
    return 'zh-cn';
  }
  return 'en';
}

export type TokenLabelContext = {
  uiLanguage: UiLanguage;
  scope: 'standard' | 'csharp';
};

export function getTokenLabel(tokenType: string, ctx: TokenLabelContext): string {
  if (ctx.uiLanguage !== 'zh-cn') {
    return tokenType;
  }

  const zh = getChineseTokenLabel(tokenType, ctx.scope);
  if (!zh) {
    return ctx.scope === 'csharp' ? `C#.${tokenType}` : tokenType;
  }
  return ctx.scope === 'csharp' ? `C#.${zh}` : zh;
}

function getChineseTokenLabel(tokenType: string, scope: 'standard' | 'csharp'): string | undefined {
  if (scope === 'standard') {
    const map: Record<string, string> = {
      namespace: '命名空间',
      type: '类型',
      class: '类',
      enum: '枚举',
      interface: '接口',
      struct: '结构体',
      typeParameter: '类型参数',
      parameter: '参数',
      variable: '变量',
      property: '属性',
      enumMember: '枚举成员',
      event: '事件',
      function: '函数',
      method: '方法',
      macro: '宏',
      keyword: '关键字',
      modifier: '修饰符',
      comment: '注释',
      string: '字符串',
      number: '数字',
      regexp: '正则',
      operator: '运算符',
      decorator: '装饰器'
    };
    return map[tokenType];
  }

  const csharpMap: Record<string, string> = {
    // 先覆盖一小部分高频 token，后续会通过“自定义别名表”完善
    constant: '常量标识符',
    field: '字段',
    local: '局部变量',
    property: '属性',
    method: '方法',
    class: '类',
    struct: '结构体',
    interface: '接口',
    enum: '枚举',
    enumMember: '枚举成员',
    parameter: '参数'
  };
  return csharpMap[tokenType];
}

