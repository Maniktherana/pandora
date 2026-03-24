//
//  RestartPolicy.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum RestartPolicy: String, Codable, CaseIterable, Identifiable {
    case manual
    case onCrash
    case always

    var id: String { rawValue }
}
