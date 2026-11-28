# How much does a lump-sum prepayment reduce my monthly payment and remaining interest? {#mortgage-prepayment}

With **{{scenario}}**, the monthly payment is **{{metric:monthly-payment}}**, compared with {{metric:baseline-payment}} if you keep the cash. The model saves **{{metric:interest-saved}}** in interest over the remaining term.

@answer span=12 live=mortgage scope="Fixed rate · 240 months remaining · End-of-month payments · No fees"
@meta locale=en style=editorial

## Where does the cash go? {#cash-path span=8}

@scenarios id=strategy default=recast
| case keep | Keep cash |
| case recast | Prepay and recast |

@architecture id=cash-flow title="Two uses for the lump sum" scenarios=strategy
| cash | Available cash | frontend |
| retained | Cash retained | backend |
| principal | Mortgage principal | database |
| payments | Recast payments | backend |
| cash > retained |
| cash > principal |
| principal > payments |
| active keep | | cash~retained |
| active recast | | cash~principal,principal~payments |
| badge node:principal | immediate-payment |
| badge node:payments | monthly-payment |

A recast recalculates the payment using the lower principal and the original maturity date. The lump sum can reduce the balance to zero.

## What are the loan terms? {#loan-terms span=4}

@calc id=mortgage
| range principal | Outstanding principal | 200000 | 2000000 | 10000 | 1200000 | USD |
| range prepayment | Proposed lump sum | 0 | 2000000 | 10000 | 200000 | USD |
| range annualPercent | Annual interest rate | 0 | 8 | 0.1 | 3.6 | % |
| let n | 240 |
| let r | annualPercent / 1200 |
| let paid | if(scenario == 'recast', min(prepayment, principal), 0) |
| let balance | principal - paid |
| let baseline | if(r == 0, principal / n, principal * r / (1 - pow(1 + r, -n))) |
| let payment | if(r == 0, balance / n, balance * r / (1 - pow(1 + r, -n))) |
| let saved | if(r == 0, 0, max(0, (baseline - payment) * n - paid)) |
| preset defaultTerms | Example terms | principal=1200000 | prepayment=200000 | annualPercent=3.6 |
| preset zeroRate | Zero interest | annualPercent=0 |
| preset fullPayment | Full prepayment | principal=1200000 | prepayment=1200000 |

Each preset changes only the specified loan terms. The selected cash strategy stays in place.

## What changes on the statement? {#payment-summary span=4}

@metric id=baseline-payment label="Monthly payment if cash is kept" calc=mortgage bind=baseline digits=2 unit=USD

@metric id=monthly-payment label="Monthly payment for this strategy" calc=mortgage bind=payment digits=2 unit=USD

@metric id=immediate-payment label="Applied to principal now" calc=mortgage bind=paid digits=0 unit=USD

@metric id=interest-saved label="Remaining interest saved" calc=mortgage bind=saved digits=2 unit=USD

## How does the balance fall over time? {#balance-chart span=8}

@chart id=balance-over-time calc=mortgage type=line title="Outstanding balance by month" unit=USD ymin=0 ymax=2000000 from=0 to=240 step=12
| line | Keep cash | if(t == n, 0, if(r == 0, max(0, principal - baseline * t), max(0, principal * pow(1+r,t) - baseline * (pow(1+r,t)-1) / r))) |
| line | Selected strategy | if(t == n, 0, if(r == 0, max(0, balance - payment * t), max(0, balance * pow(1+r,t) - payment * (pow(1+r,t)-1) / r))) |

The chart starts just after the immediate prepayment, if any. It uses annual checkpoints and sets the final balance to zero at contractual maturity.

## What does this comparison cover? {#assumptions span=12}

The calculation assumes one immediate prepayment, a lender that permits recasting, a fixed rate, and 240 equal payments at month end. It excludes fees, taxes, and returns on the cash you keep. Calculations use unrounded values and round only for display. A zero rate divides principal by the remaining term and gives no interest savings.
