"use client";

import {availableToSell,validateInventoryCounts,validateQuoteInventory,validateSalesOrderInventory} from "./inventoryAvailability";

import { salesChargeLabel, serviceChargeRange, outOfStateServiceCharge, type ServiceChargePeriod } from "./serviceCharges";

import ChangePassword from "./ChangePassword";
import OrderChargesEditor from "./OrderChargesEditor";
import { isManufacturerCharge, syncManufacturerCharges } from "./manufacturerCharges";
import { displayOrderNotes, calculateOrderCharges, plainOrderNotes, readChargeSettings, writeChargeSettings, validateChargeSettings } from "./orderCharges";

import ExpenseCsvPanel from "./ExpenseCsvPanel";

import { createClient, type Session } from "@supabase/supabase-js";
import SalesDashboard from "./SalesDashboard";
import FinanceDashboard from "./FinanceDashboard";
import OwnerDashboard from "./OwnerDashboard";
import {defaultQuoteSalesperson,salespersonOptionName} from "./quoteSalesperson";
import StockPurchaseOrders from "./StockPurchaseOrders";
import InventoryQrTag from "./InventoryQrTag";
import InventoryCountPanel from "./InventoryCountPanel";
import { type StockOrder, type StockOrderReceived } from "./stockOrders";
import type { OwnerStockReceipt } from "./ownerInventory";
import { type ExpenseAccount, type ExpenseAccountDraft, expenseKey } from "./financeAccounts";
import { dashboardModeForProfile } from "./dashboardMode";
import ClientCsvPanel, { fetchAllClients } from "./ClientCsvPanel";
import { matchesRec¶»§q«^