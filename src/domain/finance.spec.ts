import { addMonths, allocateLargestRemainder, formatDate, fromCents, isValidPlate, normalizePlate, parseDate, splitInstallments, toCents, today } from '.';

describe('dinheiro em centavos', () => {
  it('converte texto e Decimal para centavos e volta sem perda', () => {
    expect(toCents('1234.5')).toBe(123450);
    expect(toCents('0.07')).toBe(7);
    expect(toCents({ toFixed: () => '12000.00' })).toBe(1_200_000);
    expect(fromCents(123450)).toBe('1234.50');
    expect(fromCents(-5)).toBe('-0.05');
    expect(() => toCents('1,50')).toThrow();
  });

  it('parcela 1.000,00 em 3x com o resto na última parcela', () => {
    expect(splitInstallments(100_000, 3)).toEqual([33_333, 33_333, 33_334]);
    expect(splitInstallments(100, 1)).toEqual([100]);
  });

  it('rateia pelo maior resto sem perder centavos', () => {
    expect(allocateLargestRemainder(40_000, [1, 1])).toEqual([20_000, 20_000]);
    expect(allocateLargestRemainder(10_000, [1, 1, 1])).toEqual([3_334, 3_333, 3_333]);
    const parts = allocateLargestRemainder(99_999, [3, 7, 11]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99_999);
  });
});

describe('datas de negócio', () => {
  it('soma meses limitando ao fim do mês e preservando o dia preferido', () => {
    const jan31 = parseDate('2026-01-31');
    expect(formatDate(addMonths(jan31, 1))).toBe('2026-02-28');
    expect(formatDate(addMonths(jan31, 2))).toBe('2026-03-31');
    expect(formatDate(addMonths(parseDate('2028-01-31'), 1))).toBe('2028-02-29');
  });

  it('rejeita datas impossíveis', () => {
    expect(() => parseDate('2026-02-30')).toThrow();
    expect(() => parseDate('15/10/2026')).toThrow();
  });

  it('usa o fuso de São Paulo para decidir o dia de hoje', () => {
    // 02:00 UTC de 16/10 ainda é 15/10 em São Paulo (UTC-3).
    expect(formatDate(today(new Date('2026-10-16T02:00:00Z')))).toBe('2026-10-15');
  });
});

describe('placas', () => {
  it('aceita placa antiga e Mercosul, normalizando', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234');
    expect(isValidPlate('ABC1D23')).toBe(true);
    expect(isValidPlate('AB1234')).toBe(false);
  });
});
