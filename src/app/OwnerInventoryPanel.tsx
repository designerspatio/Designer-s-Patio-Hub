"use client";

import { useMemo } from "react";
import type { OwnerInventorySummary } from "./ownerInventory";
import styles from "./OwnerDashboard.module.css";

type Props = {
  summary: OwnerInventorySummary;
  loading: boolean;
  receiptsError: string;
  onInventory: () => void;
  onPurchaseOrders: () => void;
  onPurchaseOrder: (id: string) => void;
};

const money=(amount:number)=>amount.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
const date=(value:string|null)=> value ? new Date(value.slice(0,10)+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "Not set";

export default function OwnerInventoryPanel({summary,loading,receiptsError,onInventory,onPurchaseOrders,onPurchaseOrder}:Props) {
  const vendorTotals=useMemo(()=>{
    const grouped=new Map<string,{id:string;name:string;amount:number;orders:number}>();
    summary.incomingOrders.forEach(po=>{
      const id=po.manufacturerId||"unknown";
      const record=grouped.get(id)||{id,name:po.vendor,amount:0,orders:0};
      record.amount+=po.incomingCost;record.orders++;
      grouped.set(id,record);
    });
    return [...grouped.values()].sort((a,b)=>b.amount-a.amount);
  },[summary.incomingOrders]);
  return <section className={`${styles.panel} ${styles.inventoryPanel}`} aria-labelledby="owner-inventory-heading">
    <div className={styles.inventoryHeading}>
      <div><div className={styles.eyebrow}>INVENTORY & STOCK ORDERS</div>
        <h2 id="owner-inventory-heading">Inventory valuation</h2>
        <p className={styles.panelDescription}>Know the cost of merchandise you have and the stock merchandise expected to arrive.</p>
      </div>
      <div className={styles.inventoryActions}>
        <button type="button" onClick={onInventory}>Inventory records →</button>
        <button type="button" onClick={onPurchaseOrders}>Purchase orders →</button>
      </div>
    </div>
    <div className={styles.inventoryMetrics}>
      <div className={styles.inventoryMetric}>
        <span>ON-HAND INVENTORY COST</span>
        <strong>{loading?"—":money(summary.onHandCost)}</strong>
        <small>{loading?"Loading inventory…":`${summary.unitsOnHand.toLocaleString()} units · ${summary.activeSkus.toLocaleString()} stocked items`}</small>
      </div>
      <div className={styles.inventoryMetric}>
        <span>INCOMING STOCK AT COST</span>
        <strong>{loading?"—":money(summary.incomingCost)}</strong>
        <small>{loading?"Loading stock orders…":`${summary.incomingPOCount} open stock ${summary.incomingPOCount===1?"PO":"POs"} · ${summary.incomingUnits.toLocaleString()} units`}</small>
      </div>
      <div className={styles.inventoryMetric}>
        <span>ON HAND + INCOMING COST</span>
        <strong>{loading?"—":money(summary.projectedCost)}</strong>
        <small>Projected cost basis, not retail or profit</small>
      </div>
    </div>
    {summary.missingUnitCosts>0 && !loading && <p className={styles.stockNotice} role="status">
      {summary.missingUnitCosts} stocked {summary.missingUnitCosts===1?"item has":"items have"} no recorded unit cost. The on-hand valuation may be understated.
    </p>}
    {receiptsError && <p role="alert" className={styles.stockNotice}>PO receipt history could not be read. Incoming values may include partially received stock: {receiptsError}</p>}
    <div className={styles.stockHeading}>
      <div><h3>Stock purchase orders on the way</h3>
        <p>Purchase orders not linked to a client sale, excluding draft, received and closed orders. Values use acknowledged cost when available.</p>
      </div>
    </div>
    {loading ? <p className={styles.empty}>Loading stock purchase orders…</p> :
      summary.incomingOrders.length===0 ? <div className={styles.emptyStock}>
        <strong>No incoming stock purchase orders identified.</strong>
        <p>Client-specific purchase orders are excluded. The Hub currently creates POs from sales orders, so separately recorded stock orders are needed for incoming stock values to appear here.</p>
      </div> :
      <div className={styles.stockTableWrap}>
        <table className={styles.stockTable}>
          <thead><tr><th scope="col">STOCK PO</th><th scope="col">MANUFACTURER</th><th scope="col">STATUS</th><th scope="col">EST. SHIP</th><th scope="col">UNITS ON ORDER</th><th scope="col">INCOMING COST</th></tr></thead>
          <tbody>{summary.incomingOrders.map(order=><tr key={order.id}>
            <td><button type="button" onClick={()=>onPurchaseOrder(order.id)} className={styles.stockPoLink}>PO #{order.number} <span>↗</span></button></td>
            <td className={styles.stockVendor}>{order.vendor}</td>
            <td>{order.status}</td><td>{date(order.estimatedShipDate)}</td>
            <td className={styles.numeric}>{order.pendingUnits.toLocaleString()}</td>
            <td className={styles.numeric}><strong>{money(order.incomingCost)}</strong>{order.uncodedLines>0 && <small className={styles.missingCost}>Cost missing for {order.uncodedLines} line{order.uncodedLines===1?"":"s"}</small>}</td>
          </tr>)}</tbody>
          <tfoot><tr><th colSpan={5} scope="row">TOTAL INCOMING STOCK</th><td className={styles.numeric}>{money(summary.incomingCost)}</td></tr></tfoot>
        </table>
      </div>}
    {vendorTotals.length>0 && <div className={styles.stockVendorTotals}>
      <span className={styles.eyebrow}>ON ORDER BY MANUFACTURER</span>
      <div>{vendorTotals.map(row=><div key={row.id} className={styles.stockVendorTotal}>
        <span>{row.name} <small>· {row.orders} {row.orders===1?"PO":"POs"}</small></span><strong>{money(row.amount)}</strong>
      </div>)}</div>
    </div>}
    <p className={styles.inventoryFootnote}>On-hand cost = active items’ quantity on hand × unit cost. Incoming stock uses unreceived quantities on standalone stock POs, excluding customer-linked orders. Linked receipt movements are deducted when recorded; unmatched manual receipts may not reduce an open PO’s balance. Freight and tax are not included.</p>
  </section>;
}
