//
//  SessionDefinition.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

struct SessionDefinition: Identifiable, Codable, Equatable, Hashable {
    let id: String
    var slotID: String
    var kind: SessionKind
    var name: String
    var command: String
    var cwd: String?
    var port: Int?
    var envOverrides: [String: String]
    var restartPolicy: RestartPolicy
    var pauseSupported: Bool
    var resumeSupported: Bool
}
