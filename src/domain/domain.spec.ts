import { formatDocument, hasPermissions, isValidCnpj, isValidCpf, resolvePermissions } from './index';

describe('documentos', () => {
  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });
  it('valida CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
  it('formata', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('permissões', () => {
  it('OWNER tem tudo, DRIVER só o próprio', () => {
    expect(resolvePermissions('OWNER')).toContain('closing:reopen');
    expect(resolvePermissions('DRIVER')).toEqual(['company:read', 'expenses:own', 'assignments:own']);
  });
  it('extras somam ao papel, mas só os concedíveis', () => {
    const perms = resolvePermissions('MANAGER', ['finance:read', 'members:manage', 'inexistente']);
    expect(perms).toContain('finance:read');
    expect(perms).not.toContain('members:manage');
    expect(hasPermissions(perms, ['fleet:manage', 'finance:read'])).toBe(true);
  });
});
