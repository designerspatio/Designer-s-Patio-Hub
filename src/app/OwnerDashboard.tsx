"use client";

import { useEffect, useMemo, useState } from "react";
import { buildOwnerHighlights, type OwnerInput, type SalesRank } from "./ownerHighlights";
import styles from "./OwnerDashboard.module.css";

type Props = Omit<OwnerInput,"today"> & {
  firstName:string;
  loadingSales:boolean; loadingQuotes:boolean; loadingPurchases:boolean; loadingAccounting:boolean;
  onRefresh:()=>Promise<void>; onSales:()=>void; onQuotes:()=>void; onPurchases:()=>void; onAccounting:()=>void; onReports:()=>void;
};
const currency=(amount:number)=>amount.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const exactCurrency=(amount:number)=>amount.toLocaleString("en-US",{style:"currency",currency:"USD"});
const short=(amount:number)=>amount>=1e6 ? `$${(amount/1e6).toFixed(2)}M` : amount>=1e3 ? `$${(amount/1e3).toFixed(1)}K` : currency(amount);
const formatDate=(date:string)=>new Date(date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
function localDay(){const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;}

function RankChart({title,description,rows,none}:{title:string;description:string;rows:SalesRank[];none:string}) {
  const max=rows.reduce((highest,row)=>Math.max(highest,row.amount),0);
  return <section className={styles.panel}>
    <div className={styles.eyebrow}>YTD PERFORMANCE</div>
    <h2>{title}</h2><p className={styles.panelDescription}>{description}</p>
    {rows.length===0 ? <div className={styles.empty}>{none}</div> :
      <div className={styles.rankList} role="img" aria-label={title+": "+rows.map(row=>row.name+" "+exactCurrency(row.amount)).join("; ")}>
        {rows.map((row,index)=><div className={styles.rank} key={row.id}>
          <div className={styles.rankHeading}><div className={styles.rankName}><span className={styles.rankIndex}>{index+1}</span><strong>{row.name}</strong></div><strong>{currency(row.amount)}</strong></div>
          <div className={styles.track}><div className={styles.fill} style={{width:`${max>0 ? Math.max(0,Math.min(100,row.amount/max*100)) : 0}%`}}/></div>
          <div className={styles.rankMeta}>{row.count} {row.count===1?"order":"orders"} · {(row.share*100).toFixed(1)}% of sales</div>
        </div>)}
      </div>}
  </section>;
}

export default function OwnerDashboard(props:Props) {
  const [today,setToday]=useState(localDay);
  const [refreshing,setRefreshing]=useState(false);
  const [refreshedAt,setRefreshedAt]=useState("");
  useEffect(()=>{
    const onFocus=()=>setToday(localDay());
    const timer=window.setInterval(onFocus,60000);
    window.addEventListener("focus",onFocus);
    return ()=>{window.clearInterval(timer);window.removeEventListener("focus",onFocus);};
  },[]);
  const data=useMemo(()=>buildOwnerHighlights({...props,today}),[props.sales,props.saleItems,props.quotes,props.quoteItems,props.purchaseOrders,props.invoices,props.vendorPayments,props.team,props.manufacturers,today]);
  const loading=props.loadingSales||props.loadingQuotes||props.loadingPurchases||props.loadingAccounting;
  const maxMonth=data.months.reduce((max,month)=>Math.max(max,month.amount),0);
  const monthName=new Date(today+"T12:00:00").toLocaleDateString("en-US",{month:"long"});
  const bestMaker=data.topManufacturers[0],bestRep=data.salespeople[0];
  const alerts=[
    data.draftPurchaseOrders>0 && {title:`${data.draftPurchaseOrders} draft purchase ${data.draftPurchaseOrders===1?"order":"orders"}`,description:"Draft POs to review before placing with manufacturers",action:props.onPurchases},
    data.billsDueSoon>0 && {title:`${data.billsDueSoon} vendor ${data.billsDueSoon===1?"bill":"bills"} due within 7 days or overdue`,description:`${currency(data.dueSoonBalance)} in recorded open vendor invoices`,action:props.onAccounting},
    data.openQuotes>0 && {title:`${data.openQuotes} unconverted ${data.openQuotes===1?"quote":"quotes"}`,description:`${currency(data.openQuoteValue)} in quoted merchandise awaiting conversion`,action:props.onQuotes},
  ].filter((item):item is {title:string;description:string;action:()=>void}=>Boolean(item));
  const highlights=[
    data.ytdOrders>0 ? `${data.ytdOrders} sales ${data.ytdOrders===1?"order has":"orders have"} been booked this year, averaging ${currency(data.averageOrder)} in merchandise per order.` : "No booked sales orders are recorded for this year yet.",
    bestMaker ? `${bestMaker.name} leads the manufacturer mix with ${currency(bestMaker.amount)} in YTD merchandise sales.` : "Manufacturer rankings will appear once sales orders have items.",
    bestRep ? `${bestRep.name} leads the team with ${currency(bestRep.amount)} in YTD merchandise sales.` : "Salesperson rankings will appear when sales are recorded.",
    `${data.openOrders} active sales ${data.openOrders===1?"order is":"orders are"} in progress.`
  ];
  async function refresh(){
    if(refreshing)return;
    setRefreshing(true);
    try{await props.onRefresh();setToday(localDay());setRefreshedAt(new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}));}
    finally{setRefreshing(false);}
  }
  return <div className={styles.dashboard}>
    <div className={styles.hero}>
      <div><div className={styles.eyebrow}>DESIGNER'S PATIO · OWNER'S OVERVIEW</div><h1>Business highlights</h1>
        <p>Good to see you, {props.firstName}. A clear view of the numbers, opportunities and next steps shaping the business.</p>
        <div className={styles.date}>{data.year} year to date · Through {formatDate(today)}</div></div>
      <button className={styles.refresh} type="button" disabled={refreshing||loading} onClick={()=>void refresh()}>{refreshing?"Refreshing…":"↻ Refresh highlights"}</button>
    </div>
    {refreshedAt && <div role="status" className={styles.updated}>Records refreshed at {refreshedAt}</div>}
    {loading && <div role="status" className={styles.updating}>Loading business records. Highlights may update as data arrives.</div>}
    <div className={styles.quickActions}>
      <button onClick={props.onSales}>Sales orders →</button>
      <button onClick={props.onQuotes}>Quotes →</button>
      <button onClick={props.onPurchases}>Purchase orders →</button>
      <button onClick={props.onAccounting}>Accounting →</button>
      <button onClick={props.onReports}>Reports →</button>
    </div>
    <section className={styles.metrics} aria-label="Business performance indicators">
      <div className={styles.metric}><span>YTD NET MERCHANDISE SALES</span><strong>{currency(data.ytdSales)}</strong><small>{data.hasComparison && data.previousYtdSales>0 ? `${data.ytdSales>=data.previousYtdSales?"▲":"▼"} ${Math.abs((data.ytdSales-data.previousYtdSales)/data.previousYtdSales*100).toFixed(1)}% vs same period last year` : "Booked sales orders, before freight and tax"}</small></div>
      <div className={styles.metric}><span>{monthName.toUpperCase()} SALES TO DATE</span><strong>{currency(data.thisMonthSales)}</strong><small>{data.thisMonthOrders} {data.thisMonthOrders===1?"order":"orders"} booked this month</small></div>
      <div className={styles.metric}><span>YTD SALES ORDERS</span><strong>{data.ytdOrders.toLocaleString()}</strong><small>Average merchandise sale {currency(data.averageOrder)}</small></div>
      <div className={styles.metric}><span>OPEN QUOTE PIPELINE</span><strong>{currency(data.openQuoteValue)}</strong><small>{data.openQuotes} unconverted {data.openQuotes===1?"quote":"quotes"} · not booked sales</small></div>
    </section>
    <div className={styles.chartGrid}>
      <RankChart title="Top 5 manufacturers" description="Ranked by net merchandise sales on sales orders dated this year. Freight, taxes and other charges are excluded." rows={data.topManufacturers} none="No manufacturer sales recorded for this year yet."/>
      <RankChart title="Sales by team member" description="Year-to-date net merchandise sales by assigned salesperson. Team members with no sales are not shown." rows={data.salespeople} none="No sales are assigned to team members this year yet."/>
    </div>
    <div className={styles.lowerGrid}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>MONTH BY MONTH</div>
        <h2>{data.year} sales trend</h2>
        <p className={styles.panelDescription}>Net merchandise sales booked each month. The current month is partial.</p>
        <div className={styles.monthChart} role="img" aria-label={data.months.map(row=>`${row.month} ${exactCurrency(row.amount)}`).join("; ")}>
          {data.months.map(row=><div className={styles.monthGroup} key={row.month}>
            <div className={styles.monthValue}>{row.amount>0?short(row.amount):"—"}</div>
            <div className={styles.monthBarArea}><div className={styles.monthBar} style={{height:`${maxMonth>0?Math.max(0,Math.min(100,row.amount/maxMonth*100)):0}%`}}/></div>
            <span className={styles.monthLabel}>{row.month}</span>
          </div>)}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>AT A GLANCE</div><h2>What’s happening</h2>
        <div className={styles.highlights}>{highlights.map((highlight,index)=><div className={styles.highlight} key={index}><span className={styles.dot}/><p>{highlight}</p></div>)}</div>
      </section>
    </div>
    <div className={styles.lowerGrid}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>NEXT STEPS</div><h2>Items worth a look</h2>
        {alerts.length ? alerts.map(item=><button className={styles.alertRow} onClick={item.action} key={item.title}><strong>{item.title}</strong><span>{item.description}</span></button>) : <p className={styles.empty}>No draft purchase orders, near-due vendor bills or unconverted quotes currently appear in the Hub.</p>}
      </section>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>PURCHASING SNAPSHOT</div><h2>Vendor commitments</h2>
        <div className={styles.financialStat}><span>Open vendor invoice balances</span><strong>{currency(data.openVendorBalance)}</strong></div>
        <div className={styles.financialStat}><span>Open vendor invoices</span><strong>{data.openVendorBills}</strong></div>
        <div className={styles.financialStat}><span>Draft purchase orders</span><strong>{data.draftPurchaseOrders}</strong></div>
        <p className={styles.panelDescription}>Based on recorded vendor invoices and payments. Draft purchase orders are shown as a count, not as amounts due.</p>
        <button className={styles.linkButton} onClick={props.onAccounting}>Review accounting →</button>
      </section>
    </div>
    <div className={styles.personalIntro}><div className={styles.eyebrow}>YOUR PERSONAL WORKSPACE</div><h2>Checklist & notes</h2><p>Your private task list and notepad remain available below. They save to your existing Hub workspace.</p></div>
    <p className={styles.method}>Sales are assigned to the order date and the salesperson on each sales order. Manufacturer rankings use each line’s net selling price × quantity. Figures reflect Hub records available to this login and are not a cash-received or accounting profit report.</p>
  </div>;
}
