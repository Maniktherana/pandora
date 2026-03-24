//
//  SessionState.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

struct SessionState: Identifiable, Codable, Equatable {
    let id: String
    let slotID: String
    let sessionDefID: String
    let kind: SessionKind
    let name: String
    let status: SessionStatus
    let pid: Int?
    let exitCode: Int?
    let port: Int?
    let capabilities: ActionCapabilities
}
