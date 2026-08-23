import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing server environment variable: ${name}`
    );
  }

  return value;
}

function publicSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    ),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function adminSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function authenticatedHubUser(
  request: Request
) {
  const authorization =
    request.headers.get(
      "authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization.slice(7).trim();

  if (!token) return null;

  const supabase =
    publicSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(
    token
  );

  if (error || !user) {
    return null;
  }

  return user;
}

function normalizeText(
  value: unknown
) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function cleanNumber(
  value: unknown
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return (
    Math.round(parsed * 100) /
    100
  );
}

function outputText(
  payload: any
) {
  if (
    typeof payload?.output_text ===
    "string"
  ) {
    return payload.output_text;
  }

  const pieces: string[] = [];

  for (const item of
    payload?.output || []) {
    for (const content of
      item?.content || []) {
      if (
        content?.type ===
          "output_text" &&
        typeof content?.text ===
          "string"
      ) {
        pieces.push(
          content.text
        );
      }
    }
  }

  return pieces.join("\n");
}

type PurchaseOrderItem = {
  id: string;
  quantity: number | string | null;
  sku: string | null;
  description: string | null;
  finish: string | null;
  fabric_name: string | null;
  grade: string | null;
  unit_cost: number | string | null;
};

type ExtractedLine = {
  matched_po_item_id:
    | string
    | null;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  unit_cost: number | null;
  confidence: number;
};

type Extraction = {
  vendor_name: string | null;
  po_number: string | null;
  freight_amount: number | null;
  overall_confidence: number;
  notes: string;
  lines: ExtractedLine[];
};

function validateExtraction(
  value: any
): Extraction {
  if (
    !value ||
    typeof value !== "object"
  ) {
    throw new Error(
      "AI extraction did not return structured data."
    );
  }

  const lines = Array.isArray(
    value.lines
  )
    ? value.lines
    : [];

  return {
    vendor_name:
      value.vendor_name == null
        ? null
        : String(
            value.vendor_name
          ).trim() || null,
    po_number:
      value.po_number == null
        ? null
        : String(
            value.po_number
          ).trim() || null,
    freight_amount:
      cleanNumber(
        value.freight_amount
      ),
    overall_confidence:
      Math.max(
        0,
        Math.min(
          1,
          Number(
            value.overall_confidence ??
              0
          ) || 0
        )
      ),
    notes:
      String(
        value.notes || ""
      ).trim(),
    lines: lines.map(
      (
        line: any
      ): ExtractedLine => ({
        matched_po_item_id:
          line?.matched_po_item_id ==
          null
            ? null
            : String(
                line.matched_po_item_id
              ).trim() || null,
        sku:
          line?.sku == null
            ? null
            : String(
                line.sku
              ).trim() || null,
        description:
          line?.description == null
            ? null
            : String(
                line.description
              ).trim() || null,
        quantity:
          cleanNumber(
            line?.quantity
          ),
        unit_cost:
          cleanNumber(
            line?.unit_cost
          ),
        confidence:
          Math.max(
            0,
            Math.min(
              1,
              Number(
                line?.confidence ??
                  0
              ) || 0
            )
          ),
      })
    ),
  };
}

function chooseMatchedPoItemId(
  line: ExtractedLine,
  poItems: PurchaseOrderItem[],
  alreadyUsed: Set<string>
) {
  if (
    line.matched_po_item_id &&
    poItems.some(
      (item) =>
        item.id ===
        line.matched_po_item_id
    ) &&
    !alreadyUsed.has(
      line.matched_po_item_id
    )
  ) {
    return line.matched_po_item_id;
  }

  const normalizedSku =
    normalizeText(line.sku);

  if (normalizedSku) {
    const exact =
      poItems.find(
        (item) =>
          !alreadyUsed.has(
            item.id
          ) &&
          normalizeText(
            item.sku
          ) === normalizedSku
      );

    if (exact) {
      return exact.id;
    }
  }

  return null;
}

function buildStoredLines(
  extraction: Extraction,
  poItems: PurchaseOrderItem[]
) {
  const used =
    new Set<string>();

  const matched = new Map<
    string,
    ExtractedLine
  >();

  const extras: ExtractedLine[] = [];

  for (const line of
    extraction.lines) {
    const matchedId =
      chooseMatchedPoItemId(
        line,
        poItems,
        used
      );

    if (matchedId) {
      used.add(matchedId);
      matched.set(
        matchedId,
        line
      );
    } else {
      extras.push(line);
    }
  }

  const expectedLines =
    poItems.map((item) => {
      const line =
        matched.get(item.id);

      return {
        purchase_order_item_id:
          item.id,
        sku:
          line?.sku || null,
        quantity:
          line?.quantity == null
            ? null
            : Math.trunc(
                line.quantity
              ),
        unit_cost:
          line?.unit_cost ??
          null,
        extra: false,
        ai_confidence:
          line?.confidence ??
          null,
        ai_description:
          line?.description ||
          null,
      };
    });

  const extraLines =
    extras
      .filter(
        (line) =>
          line.sku ||
          line.description ||
          line.quantity != null ||
          line.unit_cost != null
      )
      .map((line) => ({
        purchase_order_item_id:
          null,
        sku:
          line.sku || null,
        quantity:
          line.quantity == null
            ? null
            : Math.trunc(
                line.quantity
              ),
        unit_cost:
          line.unit_cost ??
          null,
        extra: true,
        ai_confidence:
          line.confidence,
        ai_description:
          line.description ||
          null,
      }));

  return [
    ...expectedLines,
    ...extraLines,
  ];
}

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor_name: {
      type: [
        "string",
        "null",
      ],
    },
    po_number: {
      type: [
        "string",
        "null",
      ],
    },
    freight_amount: {
      type: [
        "number",
        "null",
      ],
    },
    overall_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    notes: {
      type: "string",
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties:
          false,
        properties: {
          matched_po_item_id: {
            type: [
              "string",
              "null",
            ],
          },
          sku: {
            type: [
              "string",
              "null",
            ],
          },
          description: {
            type: [
              "string",
              "null",
            ],
          },
          quantity: {
            type: [
              "number",
              "null",
            ],
          },
          unit_cost: {
            type: [
              "number",
              "null",
            ],
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: [
          "matched_po_item_id",
          "sku",
          "description",
          "quantity",
          "unit_cost",
          "confidence",
        ],
      },
    },
  },
  required: [
    "vendor_name",
    "po_number",
    "freight_amount",
    "overall_confidence",
    "notes",
    "lines",
  ],
};

export async function POST(
  request: Request
) {
  try {
    const user =
      await authenticatedHubUser(
        request
      );

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Hub authentication is required.",
        },
        {
          status: 401,
        }
      );
    }

    const body = await request
      .json()
      .catch(() => ({}));

    const acknowledgementId =
      String(
        body?.acknowledgement_id ||
          ""
      ).trim();

    if (!acknowledgementId) {
      return NextResponse.json(
        {
          error:
            "acknowledgement_id is required.",
        },
        {
          status: 400,
        }
      );
    }

    const admin =
      adminSupabase();

    const {
      data: acknowledgement,
      error: ackError,
    } = await admin
      .from(
        "purchase_order_acknowledgements"
      )
      .select(
        "id,purchase_order_id,file_name,file_path,vendor_name_detected,po_number_detected,comparison_status,comparison_summary,comparison_details,created_by,created_at,updated_at"
      )
      .eq(
        "id",
        acknowledgementId
      )
      .single();

    if (
      ackError ||
      !acknowledgement
    ) {
      return NextResponse.json(
        {
          error:
            ackError?.message ||
            "Acknowledgement not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      !acknowledgement.file_path
    ) {
      return NextResponse.json(
        {
          error:
            "This acknowledgement does not have an uploaded file.",
        },
        {
          status: 409,
        }
      );
    }

    const [
      poResult,
      itemResult,
    ] = await Promise.all([
      admin
        .from(
          "purchase_orders"
        )
        .select(
          "id,po_number,manufacturer_id,freight_amount"
        )
        .eq(
          "id",
          acknowledgement.purchase_order_id
        )
        .single(),
      admin
        .from(
          "purchase_order_items"
        )
        .select(
          "id,quantity,sku,description,finish,fabric_name,grade,unit_cost"
        )
        .eq(
          "purchase_order_id",
          acknowledgement.purchase_order_id
        )
        .order("sort_order", {
          ascending: true,
        }),
    ]);

    if (
      poResult.error ||
      !poResult.data
    ) {
      return NextResponse.json(
        {
          error:
            poResult.error?.message ||
            "Purchase Order could not be loaded.",
        },
        {
          status: 409,
        }
      );
    }

    if (itemResult.error) {
      return NextResponse.json(
        {
          error:
            itemResult.error.message,
        },
        {
          status: 500,
        }
      );
    }

    const poItems =
      (itemResult.data ||
        []) as PurchaseOrderItem[];

    const {
      data: manufacturer,
    } = poResult.data
      .manufacturer_id
      ? await admin
          .from(
            "manufacturers"
          )
          .select("id,name")
          .eq(
            "id",
            poResult.data
              .manufacturer_id
          )
          .maybeSingle()
      : {
          data: null,
        };

    const {
      data: signed,
      error: signedError,
    } = await admin.storage
      .from(
        "po-acknowledgements"
      )
      .createSignedUrl(
        acknowledgement.file_path,
        10 * 60
      );

    if (
      signedError ||
      !signed?.signedUrl
    ) {
      return NextResponse.json(
        {
          error:
            signedError?.message ||
            "The acknowledgement file could not be opened for AI extraction.",
        },
        {
          status: 500,
        }
      );
    }

    const expectedPoItems =
      poItems.map((item) => ({
        id: item.id,
        sku: item.sku,
        description:
          item.description,
        finish: item.finish,
        fabric_name:
          item.fabric_name,
        grade: item.grade,
        quantity:
          Number(
            item.quantity || 0
          ),
        expected_unit_cost:
          Number(
            item.unit_cost || 0
          ),
      }));

    const prompt =
      [
        "Extract the vendor acknowledgement accurately from the attached file.",
        "This is an acknowledgement for an outdoor-furniture purchase order.",
        "Use only values visibly present in the vendor acknowledgement. Do not invent missing values.",
        "For each actual product line shown on the acknowledgement, return SKU, description, acknowledged quantity, and acknowledged UNIT cost. Do not use an extended line total as unit cost.",
        "Do not return freight, tax, subtotal, total, deposits, or notes as product lines.",
        "Try to match each acknowledgement product line to one of the Hub PO items below. Put that exact Hub item id in matched_po_item_id only when the match is reasonably confident. Otherwise return null.",
        "If the acknowledgement contains an extra product not in the expected PO, return it with matched_po_item_id null.",
        "If an expected PO item is absent from the acknowledgement, do not create a fake acknowledgement line for it.",
        `Expected manufacturer: ${manufacturer?.name || "Unknown"}`,
        `Expected Hub PO number: ${poResult.data.po_number}`,
        `Expected freight currently on Hub PO: ${Number(poResult.data.freight_amount || 0)}`,
        `Expected PO items JSON: ${JSON.stringify(expectedPoItems)}`,
      ].join("\n");

    let apiKey = "";

    try {
      apiKey =
        env("OPENAI_API_KEY");
    } catch {
      return NextResponse.json(
        {
          error:
            "AI acknowledgement extraction is built, but OPENAI_API_KEY has not been added to Vercel yet.",
          setup_required:
            "OPENAI_API_KEY",
        },
        {
          status: 503,
        }
      );
    }

    const model =
      process.env
        .OPENAI_ACK_MODEL
        ?.trim() ||
      "gpt-5.6-terra";

    const aiResponse =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            model,
            store: false,
            input: [
              {
                role: "user",
                content: [
                  {
                    type:
                      "input_file",
                    file_url:
                      signed.signedUrl,
                    filename:
                      acknowledgement.file_name ||
                      "acknowledgement.pdf",
                  },
                  {
                    type:
                      "input_text",
                    text: prompt,
                  },
                ],
              },
            ],
            text: {
              format: {
                type:
                  "json_schema",
                name:
                  "vendor_acknowledgement_extraction",
                strict: true,
                schema:
                  extractionSchema,
              },
            },
          }),
          cache: "no-store",
        }
      );

    const aiPayload =
      await aiResponse
        .json()
        .catch(() => ({}));

    if (!aiResponse.ok) {
      const message =
        aiPayload?.error?.message ||
        aiPayload?.error ||
        `OpenAI extraction failed (${aiResponse.status}).`;

      return NextResponse.json(
        {
          error: message,
        },
        {
          status:
            aiResponse.status,
        }
      );
    }

    const text =
      outputText(aiPayload);

    if (!text) {
      return NextResponse.json(
        {
          error:
            "The AI extraction completed without returning acknowledgement data.",
        },
        {
          status: 502,
        }
      );
    }

    let parsed: unknown;

    try {
      parsed =
        JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error:
            "The AI extraction returned data that could not be read as structured acknowledgement information.",
        },
        {
          status: 502,
        }
      );
    }

    const extraction =
      validateExtraction(
        parsed
      );

    const storedLines =
      buildStoredLines(
        extraction,
        poItems
      );

    const previousDetails =
      acknowledgement.comparison_details &&
      typeof acknowledgement
        .comparison_details ===
        "object" &&
      !Array.isArray(
        acknowledgement
          .comparison_details
      )
        ? (
            acknowledgement.comparison_details as Record<
              string,
              unknown
            >
          )
        : {};

    const extractedAt =
      new Date().toISOString();

    const comparisonDetails = {
      ...previousDetails,
      vendor_name:
        extraction.vendor_name,
      po_number:
        extraction.po_number,
      freight_amount:
        extraction.freight_amount,
      lines: storedLines,
      ai_extraction: {
        extracted_at:
          extractedAt,
        extracted_by:
          user.id,
        model,
        overall_confidence:
          extraction.overall_confidence,
        notes:
          extraction.notes ||
          null,
        source_file:
          acknowledgement.file_name ||
          null,
      },
    };

    const {
      data: updated,
      error: updateError,
    } = await admin
      .from(
        "purchase_order_acknowledgements"
      )
      .update({
        vendor_name_detected:
          extraction.vendor_name,
        po_number_detected:
          extraction.po_number,
        comparison_status:
          "Pending",
        comparison_summary:
          `AI extraction complete${
            extraction.overall_confidence
              ? ` (${Math.round(
                  extraction.overall_confidence *
                    100
                )}% confidence)`
              : ""
          }. Review the captured values and run comparison.`,
        comparison_details:
          comparisonDetails,
        updated_at:
          extractedAt,
      })
      .eq(
        "id",
        acknowledgement.id
      )
      .select(
        "id,purchase_order_id,file_name,file_path,vendor_name_detected,po_number_detected,comparison_status,comparison_summary,comparison_details,created_by,created_at,updated_at"
      )
      .single();

    if (
      updateError ||
      !updated
    ) {
      return NextResponse.json(
        {
          error:
            updateError?.message ||
            "The acknowledgement was extracted, but the Hub could not save the captured data.",
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      status: "success",
      acknowledgement:
        updated,
      extraction: {
        model,
        overall_confidence:
          extraction.overall_confidence,
        extracted_line_count:
          extraction.lines.length,
        matched_line_count:
          storedLines.filter(
            (line) =>
              !line.extra &&
              (
                line.sku ||
                line.quantity !=
                  null ||
                line.unit_cost !=
                  null
              )
          ).length,
        extra_line_count:
          storedLines.filter(
            (line) =>
              line.extra
          ).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Acknowledgement extraction server error",
      },
      {
        status: 500,
      }
    );
  }
}
