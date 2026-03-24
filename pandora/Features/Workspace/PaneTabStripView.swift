//
//  PaneTabStripView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct WorkspaceTab: Identifiable {
    let id: String
    let title: String
}

struct PaneTabStripView: View {
    let tabs: [WorkspaceTab]
    let selectedID: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(tabs) { tab in
                Button {
                    onSelect(tab.id)
                } label: {
                    Text(tab.title)
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(tab.id == selectedID ? Color.accentColor.opacity(0.15) : Color.clear)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(8)
        .background(Color(nsColor: .underPageBackgroundColor))
    }
}
