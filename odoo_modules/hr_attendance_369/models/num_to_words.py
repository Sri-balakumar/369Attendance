"""Amounts spelled out in Indian numbering, for payslips.

Written here rather than pulled from a library on purpose: the module's only
external dependencies are pytz, dateutil and xlsxwriter, and adding one more
for a single string is a poor trade. Odoo's own `amount_to_text` follows the
Western short scale (million, billion) -- an Indian payslip wants lakh and
crore, which is what the grouping below produces.
"""

ONES = (
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
    'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
)
TENS = (
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
    'Eighty', 'Ninety',
)


def _under_thousand(number):
    """0-999 in words, no leading or trailing spaces."""
    words = []
    if number >= 100:
        words.append(ONES[number // 100])
        words.append('Hundred')
        number %= 100
        if number:
            words.append('and')
    if number >= 20:
        words.append(TENS[number // 10])
        number %= 10
    if number:
        words.append(ONES[number])
    return ' '.join(words)


def indian_words(number):
    """A whole number in Indian numbering: crore, lakh, thousand, hundred.

    Groups after the first are two digits wide, which is what makes
    1,00,000 read as "One Lakh" rather than "One Hundred Thousand".
    """
    number = int(number)
    if number < 0:
        return 'Minus ' + indian_words(-number)
    if number == 0:
        return 'Zero'

    parts = []
    crore, number = divmod(number, 10 ** 7)
    lakh, number = divmod(number, 10 ** 5)
    thousand, hundreds = divmod(number, 10 ** 3)

    if crore:
        # Beyond 99 crore the same grouping repeats, so recurse rather than
        # inventing a larger unit.
        parts.append('%s Crore' % (indian_words(crore) if crore > 99
                                   else _under_thousand(crore)))
    if lakh:
        parts.append('%s Lakh' % _under_thousand(lakh))
    if thousand:
        parts.append('%s Thousand' % _under_thousand(thousand))
    if hundreds:
        parts.append(_under_thousand(hundreds))
    return ' '.join(parts)


def amount_in_words(amount, currency_name='Rupees', fraction_name='Paise'):
    """A money amount as it is written on a payslip.

    Paise are mentioned only when there are any, because the common case --
    a net rounded to the whole rupee -- should not read "and Zero Paise".
    """
    amount = round(float(amount or 0.0), 2)
    negative = amount < 0
    amount = abs(amount)
    whole = int(amount)
    fraction = int(round((amount - whole) * 100))
    if fraction == 100:            # 0.999 rounds up into the rupee
        whole += 1
        fraction = 0

    text = '%s %s' % (currency_name, indian_words(whole))
    if fraction:
        text += ' and %s %s' % (indian_words(fraction), fraction_name)
    if negative:
        text = 'Minus ' + text
    return text + ' Only'
