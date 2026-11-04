// Company-wide owner reporting is based on recorded sales order lines, not quotations
// or client deposits. The same merchandise-sales basis is used in all charts.
export type OwnerSale = {
  id: string; order_date: string; status: string; salesperson_user_id: string | null;
};
export type OwnerLine = { manufacturer_id: string | null; quantity: number; unit_price: number };
export type OwnerQuote = {id: string; status: string; converted_sales_order_id: string | null};
export type OwnerQuoteLine = { quantity: string | number; unit_price: number };
export type OwnerPurchaseOrder = { status: string };
export type OwnerVendorInvoice = {id: string; status: string; due_date: string | null; total_amount: number};
export type OwnerVendorPayment = { vendor_invoice_id: string; amount: number };
export type OwnerPerson = {id:string; display_name: string};
export type OwnerManufacturer = {id:string; name:string};

export type OwnerInput = {
  sales: OwnerSale[];
  saleItems: Record<string, OwnerLine[]>;
  quotes: OwnerQuote[];
  quoteItems: Record<string, OwnerQuoteLine[]>;
  purchaseOrders: OwnerPurchaseOrder[];
  invoices: OwnerVendorInvoice[];
  vendorPayments: OwnerVendorPayment[];
  team: OwnerPerson[];
  manufacturers: OwnerManufacturer[];
  today: string;
};
export type SalesRank = {id: string; name: string; amount:number; count:number; share:number};
export type OwnerHighlights = {
  year:number; asOf:string; ytdSales:number; previousYtdSales:number; hasComparison:boolean;
  ytdOrders:number; averageOrder:number; thisMonthSales:number; previousMonthToDate:number;
  thisMonthOrders:number; openOrders:number; openQuotes:number; openQuoteValue:number;
  draftPurchaseOrders:number; openVendorBills:number; openVendorBalance:number;
  billsDueSoon:number; dueSoonBalance:number;
  months:{month:string;amount:number;orders:number}[];
  topManufacturers:SalesRank[]; salespeople:SalesRank[];
  totalManufacturerSales:number; totalTeamSales:number;
};

const cents=(n:number) => Math.round((n + Number.EPSILON)*100)/100;
const finite=(x:unknown)=>Number.isFinite(Number(x))?Number(x):0;
const dateOnly=(value:string|null|undefined)=>String(value||"").slice(0,10);
export const isBookedSale=(status:string)=>!["cancelled","canceled","void","voided","draft","deleted"].includes(String(status||"").trim().toLowerCase());
export const isOpenQuote=(quote:OwnerQuote)=>!quote.converted_sales_order_id &&
  !["archived","cancelled","canceled","void","voided","declined","expired","converted","deleted"].includes(String(quote.status||"").trim().toLowerCase());
const monthLabel=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const inDateRange=(day:string,start:string,end:string)=>Boolean(day && day>=start && day<=end);
function chartRanks(sums:Map<string,{amount:number; count:number}>, names:Map<string,string>):SalesRank[] {
  const entries=[...sums].filter(([,value])=>value.amount>0);
  const total=entries.reduce((acc,[,value])=>acc+value.amount,0);
  return entries.map(([id,value])=>({
    id,name:names.get(id) || (id==="__unassigned__"?"Unassigned":"Former team member / Unknown"),
    amount:cents(value.amount),count:value.count,share:total>0?value.amount/total:0
  })).sort((a,b)=>b.amount-a.amount || a.name.localeCompare(b.name));
}
export function buildOwnerHighlights(input:OwnerInput):OwnerHighlights {
  const {sales,saleItems,quotes,quoteItems,purchaseOrders,invoices,vendorPayments,team,manufacturers,today}=input;
  const asOf=dateOnly(today);
  const year=Number(asOf.slice(0,4))||new Date().getFullYear();
  const start=`${year}-01-01`;
  const previousStart=`${year-1}-01-01`;
  // Comparing Jan 1–today with the same elapsed calendar window last year.
  const previousCutoff=`${year-1}${asOf.slice(4)}`;
  const month=Number(asOf.slice(5,7))-1;
  const firstOfMonth=`${year}-${String(month+1).padStart(2,"0")}-01`;
  const previousMonthDate=new Date(year,month-1,1,12,0,0);
  const previousMonthStart=`${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth()+1).padStart(2,"0")}-01`;
  const previousMonthLastDay=new Date(year,month,0).getDate();
  const previousCutoffMonth=`${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth()+1).padStart(2,"0")}-${String(Math.min(Number(asOf.slice(8,10)),previousMonthLastDay)).padStart(2,"0")}`;

  const months=monthLabel.slice(0,Math.max(0,month+1)).map(label=>({month:label,amount:0,orders:0}));
  const manufacturerTotals=new Map<string,{amount:number;count:number}>();
  const salespersonTotals=new Map<string,{amount:number;count:number}>();
  let ytdSales=0,previousYtdSales=0,ytdOrders=0,thisMonthSales=0,previousMonthToDate=0,thisMonthOrders=0,openOrders=0;
  for (const sale of sales) {
    if (!isBookedSale(sale.status)) continue;
    const day=dateOnly(sale.order_date);
    const lineEntries=saleItems[sale.id]||[];
    const merchandise=lineEntries.reduce((sum,item)=>sum+finite(item.quantity)*finite(item.unit_price),0);
    if (["Open","On Hold","Ordered","Partially Received"].includes(sale.status)) openOrders++;
    if(inDateRange(day,previousStart,previousCutoff)) previousYtdSales+=merchandise;
    if(inDateRange(day,previousMonthStart,previousCutoffMonth)) previousMonthToDate+=merchandise;
    if(!inDateRange(day,start,asOf))continue;
    ytdSales+=merchandise;ytdOrders++;
    if(day>=firstOfMonth){thisMonthSales+=merchandise;thisMonthOrders++;}
    const mi=Number(day.slice(5,7))-1;if(months[mi]){months[mi].amount+=merchandise;months[mi].orders++;}
    const personId=sale.salesperson_user_id || "__unassigned__";
    const person=salespersonTotals.get(personId)||{amount:0,count:0};
    person.amount+=merchandise;person.count++;
    salespersonTotals.set(personId,person);
    const used=new Set<string>();
    for (const item of lineEntries){
      const id=item.manufacturer_id||"__unassigned__";
      const lineValue=finite(item.quantity)*finite(item.unit_price);
      const manufacturer=manufacturerTotals.get(id)||{amount:0,count:0};
      manufacturer.amount+=lineValue;
      if(!used.has(id)){manufacturer.count++;used.add(id);}
      manufacturerTotals.set(id,manufacturer);
    }
  }
  const names=new Map(team.map(person=>[person.id,person.display_name]));
  const manufacturerNames=new Map(manufacturers.map(manufacturer=>[manufacturer.id,manufacturer.name]));
  manufacturerNames.set("__unassigned__","Unassigned manufacturer");
  const manufacturersRank=chartRanks(manufacturerTotals,manufacturerNames);
  const peopleRank=chartRanks(salespersonTotals,names);
  const activeQuotes=quotes.filter(isOpenQuote);
  const openQuoteValue=activeQuotes.reduce((sum,quote)=>sum+(quoteItems[quote.id]||[]).reduce((itemSum,item)=>itemSum+finite(item.quantity)*finite(item.unit_price),0),0);
  const paymentsByInvoice=new Map<string,number>();
  for(const payment of vendorPayments)paymentsByInvoice.set(payment.vendor_invoice_id,(paymentsByInvoice.get(payment.vendor_invoice_id)||0)+finite(payment.amount));
  const upcomingDate=new Date(Number(asOf.slice(0,4)),Number(asOf.slice(5,7))-1,Number(asOf.slice(8,10))+7,12);
  const dateDue=`${upcomingDate.getFullYear()}-${String(upcomingDate.getMonth()+1).padStart(2,"0")}-${String(upcomingDate.getDate()).padStart(2,"0")}`;
  let openVendorBills=0,openVendorBalance=0,billsDueSoon=0,dueSoonBalance=0;
  for(const invoice of invoices){
    if(["Paid","Void"].includes(invoice.status))continue;
    const balance=Math.max(0,finite(invoice.total_amount)-(paymentsByInvoice.get(invoice.id)||0));
    if(balance<=0)continue;
    openVendorBills++;openVendorBalance+=balance;
    const due=dateOnly(invoice.due_date);
    if(due && due<=dateDue){billsDueSoon++;dueSoonBalance+=balance;}
  }
  return {
    year,asOf,ytdSales:cents(ytdSales),previousYtdSales:cents(previousYtdSales),
    hasComparison:sales.some(s=>isBookedSale(s.status)&&inDateRange(dateOnly(s.order_date),previousStart,previousCutoff)),
    ytdOrders,averageOrder:ytdOrders?cents(ytdSales/ytdOrders):0,
    thisMonthSales:cents(thisMonthSales),previousMonthToDate:cents(previousMonthToDate),thisMonthOrders,
    openOrders,openQuotes:activeQuotes.length,openQuoteValue:cents(openQuoteValue),
    draftPurchaseOrders:purchaseOrders.filter(p=>p.status==="Draft").length,
    openVendorBills,openVendorBalance:cents(openVendorBalance),billsDueSoon,dueSoonBalance:cents(dueSoonBalance),
    months:months.map(m=>({...m,amount:cents(m.amount)})),
    topManufacturers:manufacturersRank.slice(0,5),salespeople:peopleRank,
    totalManufacturerSales:cents(manufacturersRank.reduce((sum,m)=>sum+m.amount,0)),
    totalTeamSales:cents(peopleRank.reduce((sum,p)=>sum+p.amount,0))
  };
}
