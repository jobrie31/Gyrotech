import React, { useMemo } from "react";

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const HEADER_H = 42;

export default function TableauEmployesTV({
  employes = [],
  renderRow,
  maxParTableau = 20,
}) {
  // On limite à 2 tableaux max de 20 employés
  const employesLimites = useMemo(
    () => employes.slice(0, maxParTableau * 2),
    [employes, maxParTableau]
  );

  const groupes = useMemo(() => {
    return chunkArray(employesLimites, maxParTableau).slice(0, 2);
  }, [employesLimites, maxParTableau]);

  if (groupes.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 18,
          fontWeight: 700,
          background: "#ffffff",
          border: "1px solid #d1d5db",
          borderRadius: 12,
        }}
      >
        Aucun employé(e) visible pour l’instant.
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: groupes.length > 1 ? "1fr 1fr" : "1fr",
        gap: 10,
        boxSizing: "border-box",
      }}
    >
      {groupes.map((groupe, idx) => {
        const rowCount = Math.max(groupe.length, 1);

        return (
          <div
            key={idx}
            style={{
              minWidth: 0,
              minHeight: 0,
              width: "100%",
              height: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 12,
              overflow: "hidden",
              background: "#ffffff",
              boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
              display: "grid",
              gridTemplateRows: `${HEADER_H}px 1fr`,
              boxSizing: "border-box",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "28% 14% 58%",
                minHeight: 0,
              }}
            >
              <div
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  fontWeight: 900,
                  fontSize: "clamp(11px, 1.1vw, 15px)",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderBottom: "1px solid #d1d5db",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Nom
              </div>

              <div
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  fontWeight: 900,
                  fontSize: "clamp(11px, 1.1vw, 15px)",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderBottom: "1px solid #d1d5db",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Jour
              </div>

              <div
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  fontWeight: 900,
                  fontSize: "clamp(11px, 1.1vw, 15px)",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderBottom: "1px solid #d1d5db",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Projet
              </div>
            </div>

            {/* Body */}
            <div
              style={{
                minHeight: 0,
                height: "100%",
                display: "grid",
                gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
              }}
            >
              {groupe.map((emp, rowIdx) => (
                <div
                  key={`${idx}-${rowIdx}`}
                  style={{
                    minHeight: 0,
                    width: "100%",
                    height: "100%",
                  }}
                >
                  {renderRow?.(emp, `${idx}-${rowIdx}`, {
                    compactTV: true,
                    tvRowHeight: "100%",
                    tvMode: true,
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}